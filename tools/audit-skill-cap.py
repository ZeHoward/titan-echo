"""Check what raises an active skill's level cap.

ActiveSkillModel.GetActiveSkillMaxLevel starts from the skill's own defaultSkillCap and adds
AllActiveSkillCap plus a per-class cap - Knight, Warlord, Summoner and the rest. Only the first has
any source in this project, so only the first is connected.

This is not a cosmetic limit. The skill tables carry 40 rows against a default cap of 30, so the
rows the cap hides are real content: the shadow clone's level 35 multiplier is 243x its level 30.
That is why the cap has to move the buy check and the load-time clamp together - a save that
legitimately bought level 35 must not be clamped back to 30 on load.
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

GET_MAX_LEVEL = 0x223CAC0
GET_BONUS = 0x2714C88
IDENTITIES = {GET_MAX_LEVEL: 'ActiveSkillModel$$GetActiveSkillMaxLevel',
              GET_BONUS: 'BonusModel$$GetBonus'}

ALL_ACTIVE_SKILL_CAP = 12
DEFAULT_CAP_OFFSET = 0x58      # SkillParsedInfo.defaultSkillCap
# The per-class caps this project leaves alone, because nothing grants them here.
CLASS_CAPS = ['KnightActiveSkillCap', 'WarlordActiveSkillCap', 'SummonerActiveSkillCap']


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
    if int(types['values']['AllActiveSkillCap']) != ALL_ACTIVE_SKILL_CAP:
        raise ValueError('AllActiveSkillCap is no longer 12')
    name_of = {int(v): k for k, v in types['values'].items()}

    starts = sorted(by_address)
    following = {a: b for a, b in zip(starts, starts[1:])}
    elf = ELFFile(io.BytesIO(binary))
    machine = Cs(CS_ARCH_ARM64, CS_MODE_ARM)

    start = GET_MAX_LEVEL
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

    read = []
    for index, word in enumerate(words):
        if bl_target(word, start + index*4) != GET_BONUS:
            continue
        for step in range(1, 17):
            if index - step < 0:
                break
            previous, at = words[index-step], start + (index-step)*4
            if bl_target(previous, at) is not None:
                break
            if previous >> 24 == 0x52 and (previous & 0x1F) == 1:
                read.append(name_of.get((previous >> 5) & 0xFFFF, (previous >> 5) & 0xFFFF))
                break

    if not read or read[0] != 'AllActiveSkillCap':
        raise ValueError(f'the cap no longer starts from AllActiveSkillCap: {read}')
    missing = [name for name in CLASS_CAPS if name not in read]
    if missing:
        raise ValueError(f'the per-class caps changed: {missing} no longer read')
    if not any(re.fullmatch(rf'ldr w\d+, \[x\d+, #{DEFAULT_CAP_OFFSET:#x}\]', line) for line in text):
        raise ValueError('the default cap field moved')

    document = {
        'version': '8.2.0',
        'role': '主動技能的等級上限：技能自己的預設上限加上各種 Cap 加成。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': 'ActiveSkillModel.GetActiveSkillMaxLevel 由該技能的 defaultSkillCap 起算，'
                   f'加上 AllActiveSkillCap，再加上依職業分的 {len(CLASS_CAPS)} 個 Cap 加成。'
                   '本專案只有 AllActiveSkillCap 有來源（「暗黑天使」神話套裝 +5），'
                   '職業那幾個沒有任何神器、天賦、寵物或套裝會給，所以不接。',
        'expression': '技能等級上限 = defaultSkillCap + AllActiveSkillCap + 該職業的 Cap',
        'methods': {name: hex(address) for address, name in IDENTITIES.items()},
        'bonusesRead': read,
        'classCapsNotConnected': CLASS_CAPS,
        'defaultCapField': {'offset': hex(DEFAULT_CAP_OFFSET), 'name': 'SkillParsedInfo.defaultSkillCap'},
        'consequence': '**這不是裝飾性的上限**：技能資料表每個技能有 40 列，預設上限只有 30，'
                       '被擋住的那幾列是真的內容——影分身 35 級的倍率是 30 級的 243 倍。'
                       '所以接上它要同時動購買檢查與載入時的夾擠：'
                       '合法買到 35 級的存檔不能在載入時被夾回 30。'
                       '本專案另外把上限夾在資料表列數（40），避免超出表格。',
        'limits': ['方法存在、位址與它讀的加成是事實；以暫存器傳入的參數不會出現在 bonusesRead',
                   '職業專屬的 Cap 在本專案沒有來源，屬於「接了也不會生效」而不是「原生沒有」',
                   '資料表 40 列是本專案匯入的 ActiveSkillInfo 的列數，不是原生的硬上限'],
    }
    target = ROOT/'reference/tt2/8.2.0/skill-cap-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Verified the skill cap: {len(read)} bonuses read, starting from {read[0]}')


if __name__ == '__main__':
    main()
