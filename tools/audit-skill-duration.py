"""Check how an active skill's duration is built.

Two sums, then one product. The seconds sum starts at 0 and collects this skill's own SkillDuration
plus AllActiveSkillDuration; the multiplier sum starts at 1 and collects this skill's
SkillDurationMult plus AllActiveSkillDurationMult; the result is (duration + seconds) x multiplier.

Those two starting constants are the whole thing worth verifying. Reading them off the call order
alone would be guessing - GHDouble operators write through out-pointers, so the arithmetic only
becomes visible by following which stack slot each result lands in. Getting the multiplier's start
wrong in the obvious direction (0 instead of 1) would zero every skill duration for anyone without
the bonus, which is exactly the shape of bug 2.14.5 hit from the other side.

The per-skill bonus types arrive from GetSkillDurationBonusType in a register, and a skill that has
none takes a branch that skips its own term - the native counterpart of this project's skillBonus
existence check.
"""
import hashlib
import io
import json
import pathlib
import struct
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCAL = ROOT/'work/apk-analysis'
sys.path.insert(0, str(LOCAL/'python-libs'))
from capstone import Cs, CS_ARCH_ARM64, CS_MODE_ARM
from elftools.elf.elffile import ELFFile

GET_DURATION = 0x223EA88
GET_BONUS = 0x2714C88
IMPLICIT = 0x21CEFAC          # GHDouble.op_Implicit(int)
ADDITION = 0x21DE5CC
MULTIPLY = 0x21DD6EC
DURATION_BONUS_TYPE = 0x223FA8C

IDENTITIES = {
    GET_DURATION: 'SkillParsedInfo$$GetDuration',
    GET_BONUS: 'BonusModel$$GetBonus',
    ADDITION: 'GHDouble$$op_Addition',
    MULTIPLY: 'GHDouble$$op_Multiply',
    DURATION_BONUS_TYPE: 'SkillParsedInfo$$GetSkillDurationBonusType',
}

ALL_ACTIVE_SKILL_DURATION = 4
ALL_ACTIVE_SKILL_DURATION_MULT = 5
DURATION_FIELD_OFFSET = 0x3C   # SkillParsedInfo.duration


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
    for label, number in (('AllActiveSkillDuration', ALL_ACTIVE_SKILL_DURATION),
                          ('AllActiveSkillDurationMult', ALL_ACTIVE_SKILL_DURATION_MULT)):
        if int(types['values'][label]) != number:
            raise ValueError(f'{label} is no longer {number}')

    starts = sorted(by_address)
    following = {a: b for a, b in zip(starts, starts[1:])}
    elf = ELFFile(io.BytesIO(binary))
    machine = Cs(CS_ARCH_ARM64, CS_MODE_ARM)

    start = GET_DURATION
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

    # The two seeds: the last immediate moved into w0 before each of the first two op_Implicit calls.
    seeds = []
    for index, word in enumerate(words):
        if bl_target(word, start + index*4) != IMPLICIT:
            continue
        for step in range(1, 9):
            if index - step < 0:
                break
            previous = words[index-step]
            if previous == 0xD280001F | (0 << 5):        # mov w0, wzr is encoded as movz w0,#0
                seeds.append(0)
                break
            if previous == 0x52800000 | (0 << 5):        # movz w0, #0
                seeds.append(0)
                break
            if previous >> 24 == 0x52 and (previous & 0x1F) == 0:
                seeds.append((previous >> 5) & 0xFFFF)
                break
            if previous == 0x2A1F03E0:                   # mov w0, wzr
                seeds.append(0)
                break
        if len(seeds) == 2:
            break
    if seeds != [0, 1]:
        raise ValueError(f'the two sums no longer start at 0 and 1: {seeds}')

    calls = []
    for index, word in enumerate(words):
        target = bl_target(word, start + index*4)
        if target == GET_BONUS:
            bonus = None
            for step in range(1, 17):
                if index - step < 0:
                    break
                previous, at = words[index-step], start + (index-step)*4
                if bl_target(previous, at) is not None:
                    break
                if previous >> 24 == 0x52 and (previous & 0x1F) == 1:
                    bonus = (previous >> 5) & 0xFFFF
                    break
            calls.append(bonus)

    if calls != [None, ALL_ACTIVE_SKILL_DURATION, None, ALL_ACTIVE_SKILL_DURATION_MULT]:
        raise ValueError(f'the duration no longer reads four bonuses in that order: {calls}')

    named = [by_address.get(bl_target(word, start + index*4))
             for index, word in enumerate(words) if bl_target(word, start + index*4) in by_address]
    if named.count('GHDouble$$op_Multiply') != 1:
        raise ValueError('the duration is no longer a single product of the two sums')
    if named.count('GHDouble$$op_Addition') != 5:
        raise ValueError(f'the sums changed shape: {named.count("GHDouble$$op_Addition")} additions')
    if 'SkillParsedInfo$$GetSkillDurationBonusType' not in named:
        raise ValueError('the per-skill duration bonus is no longer looked up by type')
    if not any(line == f'ldr s8, [x19, #{DURATION_FIELD_OFFSET:#x}]' for line in text):
        raise ValueError('the base duration field moved')

    document = {
        'version': '8.2.0',
        'role': '主動技能的持續時間：兩個加法組再相乘，兩個起點分別是 0 與 1。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': 'SkillParsedInfo.GetDuration 先建兩個加總：秒數那組**從 0 起算**，'
                   '收該技能自己的 SkillDuration 與 AllActiveSkillDuration；'
                   '倍率那組**從 1 起算**，收該技能自己的 SkillDurationMult 與 AllActiveSkillDurationMult。'
                   '最後是 (基礎 duration ＋ 秒數組) × 倍率組，只有一次乘法、五次加法。'
                   '兩個逐技能的加成型別由 GetSkillDurationBonusType 以暫存器傳入，'
                   '該技能沒有對應加成時走分支跳過自己那一項——'
                   '對應本專案 skillBonus 的存在性檢查（天堂聖擊就沒有 SkillDuration 與 SkillDurationMult）。',
        'expression': '持續 = (基礎 + 該技能 SkillDuration + AllActiveSkillDuration) '
                      '× (1 + 該技能 SkillDurationMult + AllActiveSkillDurationMult)',
        'seeds': {'seconds': 0, 'multiplier': 1},
        'methods': {name: hex(address) for address, name in IDENTITIES.items()},
        'bonusOrder': ['（該技能的 SkillDuration，暫存器）', 'AllActiveSkillDuration',
                       '（該技能的 SkillDurationMult，暫存器）', 'AllActiveSkillDurationMult'],
        'durationField': {'offset': hex(DURATION_FIELD_OFFSET), 'name': 'SkillParsedInfo.duration'},
        'consequence': '本專案原本只做了秒數那組，倍率那組整個沒有讀。這一版接上，'
                       '唯一拿得到的來源是「獵人」傳說套裝（AllActiveSkillDurationMult 0.1），'
                       '六個技能的持續時間各 ×1.1。兩個 Mult 加成都是加法型，沒有來源時倍率組停在 1，'
                       '持續時間與上一版相同。',
        'limits': ['方法存在、位址、呼叫順序與兩個起點是事實；起點以「op_Implicit 前最後寫進 w0 的立即數」判定',
                   '逐技能的加成型別以暫存器傳入，本表不列出它們的身分',
                   '本表只涵蓋持續時間，冷卻與耗魔是另外的方法'],
    }
    target = ROOT/'reference/tt2/8.2.0/skill-duration-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Verified the skill duration: sums seeded at {seeds[0]} and {seeds[1]}, '
          f'{len(calls)} bonuses, one product')


if __name__ == '__main__':
    main()
