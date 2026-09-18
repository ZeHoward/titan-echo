"""Check what trims the number of titans a stage holds.

StageLogic.GetRawMonsterCountPerStage gives the curve this project already matches. The wrapper,
GetMonsterCountPerStage(stageNum, splashSkip, isInactiveGameplay), is where the count gets reduced:
it subtracts MonsterCountPerStage from the rounded raw count, subtracts a second bonus when a
contract is running, scales by the special-titan stack multiplier, and finally takes
Math.Max(1, count - splashSkip).

The direction is the point. The name reads like "how many per stage", but the arithmetic is a
subtraction and the stats panel files it under reductions - adding it instead would make stages
longer for anyone who earned the set. splashSkip is a parameter the caller passes for that one
kill, not state, so it is no part of "how many this stage holds".
"""
import hashlib
import io
import json
import pathlib
import re
import struct
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCAL = ROOT/'work/apk-analysis'
sys.path.insert(0, str(LOCAL/'python-libs'))
from capstone import Cs, CS_ARCH_ARM64, CS_MODE_ARM
from elftools.elf.elffile import ELFFile

GET_COUNT = 0x2546594
GET_RAW = 0x25468A0
GET_BONUS = 0x2714C88
MATH_MAX = 0x3FCC0F4
IS_CONTRACT_ACTIVE = 0x25188AC

IDENTITIES = {
    GET_COUNT: 'StageLogic$$GetMonsterCountPerStage',
    GET_RAW: 'StageLogic$$GetRawMonsterCountPerStage',
    GET_BONUS: 'BonusModel$$GetBonus',
    MATH_MAX: 'System.Math$$Max',
    IS_CONTRACT_ACTIVE: 'SkillTreeSkills$$IsAnyContractActive',
}
SIGNATURE = 'public virtual int GetMonsterCountPerStage(int stageNum, int splashSkip = 0, bool isInactiveGameplay = False)'
# Systems this project has not built, whose terms live in the same method.
NOT_BUILT = ['IsAnyContractActive 的契約減免', '特殊泰坦堆疊的倍率']


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    baseline = json.loads((ROOT/'docs/reference-baseline.json').read_text(encoding='utf-8'))
    package = (LOCAL/'tap-titans-2-8.2.0.xapk').read_bytes()
    if sha(package) != baseline['package']['sha256']:
        raise ValueError('package mismatch')
    binary = (LOCAL/'libil2cpp.so').read_bytes()
    with zipfile.ZipFile(io.BytesIO(package)) as outer:
        with zipfile.ZipFile(io.BytesIO(outer.read('config.arm64_v8a.apk'))) as apk:
            if binary != apk.read('lib/arm64-v8a/libil2cpp.so'):
                raise ValueError('native binary differs from pinned APK')

    script_bytes = (LOCAL/'dump/script.json').read_bytes()
    script = json.loads(script_bytes)
    by_address = {}
    for method in script['ScriptMethod']:
        by_address.setdefault(method['Address'], method['Name'])
    for address, name in IDENTITIES.items():
        if by_address.get(address) != name:
            raise ValueError(f'method identity mismatch at {address:#x}: {by_address.get(address)}')

    types = json.loads((ROOT/'reference/tt2/8.2.0/native-bonus-types.json').read_text(encoding='utf-8'))
    bonus_id = int(types['values']['MonsterCountPerStage'])

    starts = sorted(by_address)
    following = {a: b for a, b in zip(starts, starts[1:])}
    elf = ELFFile(io.BytesIO(binary))
    machine = Cs(CS_ARCH_ARM64, CS_MODE_ARM)

    start = GET_COUNT
    end = following[start]
    segment = next(s for s in elf.iter_segments()
                   if s['p_type'] == 'PT_LOAD' and s['p_vaddr'] <= start
                   and end <= s['p_vaddr'] + s['p_filesz'])
    body = binary[start - segment['p_vaddr'] + segment['p_offset']:][:end - start]
    words = struct.unpack_from(f'<{len(body)//4}I', body, 0)
    text = [f'{i.mnemonic} {i.op_str}' for i in machine.disasm(body, start)]

    def bl_target(word, address):
        if word >> 26 != 0b100101:
            return None
        offset = word & 0x3FFFFFF
        if offset & 0x2000000:
            offset -= 0x4000000
        return address + offset*4

    called, reads = [], []
    for index, word in enumerate(words):
        target = bl_target(word, start + index*4)
        if target in by_address:
            called.append(by_address[target])
        if target == GET_BONUS:
            for step in range(1, 17):
                if index - step < 0:
                    break
                previous, at = words[index-step], start + (index-step)*4
                if bl_target(previous, at) is not None:
                    break
                if previous >> 24 == 0x52 and (previous & 0x1F) == 1:
                    reads.append((previous >> 5) & 0xFFFF)
                    break

    if 'StageLogic$$GetRawMonsterCountPerStage' not in called:
        raise ValueError('the wrapper no longer starts from the raw curve')
    if bonus_id not in reads:
        raise ValueError(f'MonsterCountPerStage ({bonus_id}) is no longer read here: {reads}')
    if 'System.Math$$Max' not in called:
        raise ValueError('the count is no longer floored')
    if 'SkillTreeSkills$$IsAnyContractActive' not in called:
        raise ValueError('the contract branch is gone; the shape of this method changed')
    # The reduction is a subtraction, not an addition.
    if not any(re.fullmatch(r'sub w\d+, w\d+, w\d+', line) for line in text):
        raise ValueError('the bonus is no longer subtracted from the count')
    if any(re.fullmatch(r'add w22, w22, w\d+', line) for line in text):
        raise ValueError('the count now adds a register term; the direction may have flipped')

    dump = (LOCAL/'dump/dump.cs').read_text(encoding='utf-8', errors='replace')
    if SIGNATURE not in dump:
        raise ValueError('the wrapper signature changed; splashSkip may no longer be a parameter')

    document = {
        'version': '8.2.0',
        'role': '每關的泰坦隻數怎麼被扣掉：加成是減免，不是增加。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': 'StageLogic.GetMonsterCountPerStage(stageNum, splashSkip, isInactiveGameplay) '
                   '先取 GetRawMonsterCountPerStage 的曲線值，'
                   f'再**減去** Bonus(MonsterCountPerStage)（編號 {bonus_id}，轉 int 是截斷）；'
                   '接著在契約生效時減第二個加成、乘上特殊泰坦堆疊的倍率，'
                   '最後 Math.Max(1, 隻數 − splashSkip)。'
                   '**方向是關鍵**：名字讀起來像「每關幾隻」，但運算是減法，'
                   '統計面板也把它歸在「減免」那一欄——寫成加法會讓拿到套裝的人每關反而更長。'
                   'splashSkip 是呼叫端為了那一次擊殺傳進來的參數，不是狀態，'
                   '所以不屬於「這一關有幾隻」。',
        'expression': '每關隻數 = max(1, round(原始曲線) − MonsterCountPerStage − 契約減免) × 特殊泰坦倍率',
        'methods': {name: hex(address) for address, name in IDENTITIES.items()},
        'signature': SIGNATURE,
        'bonus': {'name': 'MonsterCountPerStage', 'id': bonus_id, 'direction': 'subtract'},
        'notImplementedHere': NOT_BUILT,
        'consequence': '本專案接上了減免與下限 1，唯一來源是「剋星」傳說套裝（5 隻）：'
                       '第 1 關 8→3 隻、第 500 關 10→5 隻、第 2000 關 17→12 隻、關卡上限 120→115 隻。'
                       '契約減免與特殊泰坦倍率屬於未實作的系統，不在這裡折算；'
                       'splashSkip 也不併進來，本專案的濺射結算在別處（見 skip-evidence.json）。',
        'limits': ['方法存在、位址、它呼叫的方法與讀的加成是事實；減法方向以指令本身判定',
                   '**下限 1 與「轉 int 是截斷」這兩段在本專案現有資料下觀測不到**：'
                   '唯一來源「剋星」套裝給整數 5，而最小隻數是第 1 關的 8，'
                   '所以把下限拿掉或改成四捨五入都不會改變任何結果。兩段仍照原生實作，'
                   '並由 tests/monster-count-reduction.test.mjs 釘住那個前提——'
                   '將來出現小數或更大的減免來源時，該測試會先轉紅。',
                   '契約與特殊泰坦那兩項在原生同一個方法裡，本專案未實作，屬於刻意省略而非原生沒有',
                   '本表只涵蓋隻數的減免，曲線本身見 monster-count-evidence.json'],
    }
    target = ROOT/'reference/tt2/8.2.0/monster-count-reduction-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Verified the monster-count reduction: bonus {bonus_id} is subtracted, floored at 1, '
          f'{len(NOT_BUILT)} terms left to unbuilt systems')


if __name__ == '__main__':
    main()
