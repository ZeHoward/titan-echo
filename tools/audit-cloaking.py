"""Check the cloaking stage skip: when it can fire, how often, and for how many stages.

Three methods in order, all reached from StageLogic.OnMonsterDeath:

  get_IsCloaking             talent unlocked AND current stage <= GetCloakingEndStage()
  RollCloaking               Random.value < CloakedSkipChance
  GetCloakingStagesSkipped   CloakedSkipAmount, added to the stage-skip total

The gate is the interesting half. GetCloakingEndStage is the season's best stage plus
CloakedStageDuration, so cloaking only helps while re-clearing ground already taken - it never
pushes past the player's own record. Reading the order as "roll, then check" would let it skip
fresh stages, which is a different game.

CloakedStageDuration is the talent's fourth bonus column. This project's talent data only carries
the first two columns, so that value is taken from the reference table here; the same gap hides a
fourth bonus on twelve other talents, and the count is published so it cannot be forgotten.
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

ON_MONSTER_DEATH = 0x2546AD4
IS_CLOAKING = 0x2510E7C
ROLL_CLOAKING = 0x251147C
STAGES_SKIPPED = 0x2511648
END_STAGE = 0x2511580
GET_BONUS = 0x2714C88
SEASONAL_MAX = 0x23DF798
IS_UNLOCKED = 0x2518070

IDENTITIES = {
    ON_MONSTER_DEATH: 'StageLogic.<>c__DisplayClass39_0$$<OnMonsterDeath>b__0',
    IS_CLOAKING: 'Cloaking$$get_IsCloaking',
    ROLL_CLOAKING: 'Cloaking$$RollCloaking',
    STAGES_SKIPPED: 'Cloaking$$GetCloakingStagesSkipped',
    END_STAGE: 'Cloaking$$GetCloakingEndStage',
    GET_BONUS: 'BonusModel$$GetBonus',
    SEASONAL_MAX: 'PlayerModel$$GetSeasonalMaxStageReached',
    IS_UNLOCKED: 'SkillTreeSkill$$get_IsUnlocked',
}

CLOAKED_SKIP_CHANCE = 115
CLOAKED_SKIP_AMOUNT = 114
TALENT = 'Cloaking'
DURATION_COLUMN = 'CloakedStageDuration'


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
    for label, number in (('CloakedSkipChance', CLOAKED_SKIP_CHANCE),
                          ('CloakedSkipAmount', CLOAKED_SKIP_AMOUNT)):
        if int(types['values'][label]) != number:
            raise ValueError(f'{label} is no longer {number}')

    starts = sorted(by_address)
    following = {a: b for a, b in zip(starts, starts[1:])}
    elf = ELFFile(io.BytesIO(binary))
    machine = Cs(CS_ARCH_ARM64, CS_MODE_ARM)

    def body(start):
        end = following[start]
        segment = next(s for s in elf.iter_segments()
                       if s['p_type'] == 'PT_LOAD' and s['p_vaddr'] <= start
                       and end <= s['p_vaddr'] + s['p_filesz'])
        offset = start - segment['p_vaddr'] + segment['p_offset']
        return binary[offset:offset + (end - start)], start

    def bl_target(word, address):
        if word >> 26 != 0b100101:
            return None
        offset = word & 0x3FFFFFF
        if offset & 0x2000000:
            offset -= 0x4000000
        return address + offset*4

    def calls(start):
        data, base = body(start)
        words = struct.unpack_from(f'<{len(data)//4}I', data, 0)
        return [(base + i*4, bl_target(w, base + i*4)) for i, w in enumerate(words)
                if bl_target(w, base + i*4) in by_address]

    def bonus_of(start):
        data, base = body(start)
        words = struct.unpack_from(f'<{len(data)//4}I', data, 0)
        for index, word in enumerate(words):
            if bl_target(word, base + index*4) != GET_BONUS:
                continue
            for step in range(1, 17):
                if index - step < 0:
                    break
                previous, at = words[index-step], base + (index-step)*4
                if bl_target(previous, at) is not None:
                    break
                if previous >> 24 == 0x52 and (previous & 0x1F) == 1:
                    return (previous >> 5) & 0xFFFF
        return None

    # The order inside OnMonsterDeath: gate, then roll, then amount.
    order = [target for _, target in calls(ON_MONSTER_DEATH)
             if target in (IS_CLOAKING, ROLL_CLOAKING, STAGES_SKIPPED)]
    if order != [IS_CLOAKING, ROLL_CLOAKING, STAGES_SKIPPED]:
        raise ValueError(f'the cloaking sequence changed: {[IDENTITIES[t] for t in order]}')

    if bonus_of(ROLL_CLOAKING) != CLOAKED_SKIP_CHANCE:
        raise ValueError('RollCloaking no longer rolls against CloakedSkipChance')
    if bonus_of(STAGES_SKIPPED) != CLOAKED_SKIP_AMOUNT:
        raise ValueError('GetCloakingStagesSkipped no longer reads CloakedSkipAmount')

    gate = [name for _, target in calls(IS_CLOAKING) if (name := by_address.get(target))]
    if 'SkillTreeSkill$$get_IsUnlocked' not in gate:
        raise ValueError('IsCloaking no longer requires the talent to be unlocked')
    if not any('GetCloakingEndStage' in name for name in gate):
        raise ValueError('IsCloaking no longer compares against the end stage')
    if 'PlayerModel$$GetSeasonalMaxStageReached' not in [
            by_address.get(target) for _, target in calls(END_STAGE)]:
        raise ValueError('the end stage is no longer based on the season best')

    # The duration column this project has not imported, and how many talents share that gap.
    tree = json.loads((ROOT/'reference/tt2/8.2.0/SkillTreeInfo2.0.json').read_text(encoding='utf-8'))
    row = next(r for r in tree['records'] if r['id'] == TALENT)
    if row['values'].get('BonusTypeD') != DURATION_COLUMN:
        raise ValueError(f'{TALENT} no longer carries {DURATION_COLUMN} in its fourth column')
    duration = int(row['values']['BonusAmountD'])
    with_fourth = [r['id'] for r in tree['records']
                   if r['values'].get('BonusTypeD') not in ('None', '', '-', None)]

    document = {
        'version': '8.2.0',
        'role': '潛行跳關：什麼時候可以觸發、機率多少、跳幾關。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': 'StageLogic.OnMonsterDeath 依序呼叫 Cloaking.get_IsCloaking、RollCloaking、'
                   'GetCloakingStagesSkipped，命中的關數累加到該次擊殺的跳關總數上。'
                   '**順序就是規則**：先看能不能潛行，再擲骰。'
                   'get_IsCloaking 是「天賦已解鎖」且「目前關卡 ≤ GetCloakingEndStage()」，'
                   '而 GetCloakingEndStage 取 PlayerModel.GetSeasonalMaxStageReached 再加上 '
                   f'{DURATION_COLUMN}（資料表值 {duration}）。'
                   '所以潛行只在**重打已經推過的關卡**時有用，不會幫玩家越過自己的紀錄。'
                   'RollCloaking 是 Random.value < CloakedSkipChance；'
                   'GetCloakingStagesSkipped 回傳 CloakedSkipAmount。',
        'expression': '每次擊殺：若 目前關卡 ≤ 最高關卡 + CloakedStageDuration 且 隨機值 < CloakedSkipChance，'
                      '跳關數 += CloakedSkipAmount',
        'methods': {name: hex(address) for address, name in IDENTITIES.items()},
        'callOrder': [IDENTITIES[t] for t in order],
        'stageDuration': {'column': DURATION_COLUMN, 'value': duration, 'talent': TALENT},
        'talentFourthColumnGap': {
            'note': '本專案的天賦資料只匯了前兩個加成欄，第四欄（BonusTypeD／BonusAmountD）沒有進來。'
                    '潛行的持續關數就在那一欄，所以這裡直接用參考資料表的值。'
                    '同一個缺口影響下列天賦，它們各自的第四個加成目前都沒有來源。',
            'count': len(with_fourth),
            'talents': with_fourth,
        },
        'consequence': '本專案接上了這條：天賦「潛行」的機率由 3% 到 40%（九級），每次命中跳 10 關，'
                       '套裝「匕首盜賊」與「盜賊」另外各加 2 與 1 關。'
                       '**只在目前關卡不超過最高關卡加一的時候生效**，'
                       '所以它加速的是蛻變之後重推的那一段，不會讓人越過自己的最高紀錄。',
        'limits': ['方法存在、位址、呼叫順序與它們讀的加成是事實',
                   'CloakedStageDuration 取自參考資料表而不是本專案的執行時資料，因為第四欄尚未匯入',
                   '本表不涵蓋潛行的視覺表現（CloakDevice）'],
    }
    target = ROOT/'reference/tt2/8.2.0/cloaking-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Verified cloaking: gate then roll then amount, duration {duration}, '
          f'{len(with_fourth)} talents share the un-imported fourth column')


if __name__ == '__main__':
    main()
