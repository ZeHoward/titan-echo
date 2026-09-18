"""Check where the CritDamage bonus is actually consumed; publish evidence facts, not dumps.

A damage multiplier is only correct if it is applied in the one place the native game applies it.
CritDamage looks like a general damage bonus and is easy to fold into a shared multiplier, but
natively it is read exactly once - PlayerModel.RefreshCriticalValues - and only to build the
critical multiplier (playerCritMult x Bonus(CritDamage)). Nothing on the ordinary damage path
touches it. This sweeps the whole image for the GetBonus call sites of that bonus, with three
bonuses whose readers are already known as the control group, so "nobody reads it" can be told
apart from a sweep that silently returns nothing.

It also records the multiplier order of GetSwordMasterDamage, which is the tap-damage term the
project composes by hand: level x GetImprovementBonus x playerDamageMult x Bonus(SwordMasterDamage)
x Bonus(TapDamage) x Bonus(AllDamage), floored by Max - five multiplies, no crit factor.
"""
import bisect
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

GET_BONUS = 0x2714C88
REFRESH_CRITICAL = 0x23DA120
GET_SWORD_MASTER = 0x23E272C
PERFORM_ATTACK = 0x2542888

IDENTITIES = {
    GET_BONUS: 'BonusModel$$GetBonus',
    REFRESH_CRITICAL: 'PlayerModel$$RefreshCriticalValues',
    GET_SWORD_MASTER: 'PlayerModel$$GetSwordMasterDamage',
    PERFORM_ATTACK: 'StageLogic$$PerformAttackMonster',
}

CRIT_CHANCE = 133
ALL_PROBABILITY_BOOST = 27
CRIT_DAMAGE = 134
CRIT_BOOST_SKILL_CRIT_DAMAGE = 132
CRIT_BOOST_SKILL_ID = 3        # ActiveSkillID.CritBoost
ALL_DAMAGE = 37
SWORD_MASTER_DAMAGE = 448
TAP_DAMAGE = 457
TITAN_DAMAGE = 505
BOSS_DAMAGE = 72

# The one method allowed to read CritDamage, and the controls that prove the sweep works.
CRIT_DAMAGE_READER = 'PlayerModel$$RefreshCriticalValues'
CONTROLS = {SWORD_MASTER_DAMAGE: 'SwordMasterDamage', TAP_DAMAGE: 'TapDamage', ALL_DAMAGE: 'AllDamage'}

# ServerVarsModel static offsets read by RefreshCriticalValues and GetSwordMasterDamage.
CRIT_MULT = 0xBB4
MAX_CRIT_CHANCE = 0xBB8
BASE_CRIT_CHANCE = 0xBB0
PLAYER_DAMAGE_MULT = 0xBA4

# MOVZ W1, #imm16 -> 0x52800000 | imm16<<5 | 1. GetBonus takes the id in w1, so one masked sweep
# over the loaded segments lists every call site that asks for a given bonus.
MOVZ_W1 = 0x52800000
CALL_WINDOW = 16


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

    starts = sorted(by_address)
    following = {a: b for a, b in zip(starts, starts[1:])}
    elf = ELFFile(io.BytesIO(binary))
    segments = [s for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD' and s['p_filesz']]
    machine = Cs(CS_ARCH_ARM64, CS_MODE_ARM)

    def body(start):
        end = following[start]
        segment = next(s for s in segments if s['p_vaddr'] <= start
                       and end <= s['p_vaddr'] + s['p_filesz'])
        offset = start - segment['p_vaddr'] + segment['p_offset']
        return binary[offset:offset + (end - start)]

    decode = lambda start: list(machine.disasm(body(start), start))
    text = lambda start: [f'{i.mnemonic} {i.op_str}' for i in decode(start)]

    def calls(start):
        out = []
        for instruction in decode(start):
            if instruction.mnemonic in ('bl', 'b') and instruction.op_str.startswith('#'):
                name = by_address.get(int(instruction.op_str.lstrip('#'), 16))
                if name:
                    out.append(name)
        return out

    def owner(address):
        index = bisect.bisect_right(starts, address) - 1
        return by_address[starts[index]] if index >= 0 else None

    def bl_target(word, address):
        if word >> 26 != 0b100101:
            return None
        offset = word & 0x3FFFFFF
        if offset & 0x2000000:
            offset -= 0x4000000
        return address + offset*4

    def bonus_readers(bonus_id):
        """Every method that passes bonus_id to GetBonus, by name, with its call sites.

        Walks back from each call rather than forward from each immediate. Forward matching
        credits any immediate that happens to sit within the window before an unrelated call, and
        BonusModel.ModifyBonus takes its target the same way GetBonus does - RefreshSkillPointBonuses
        sets up AllDamage for a ModifyBonus a dozen instructions before a GetBonus for a different
        bonus, and a forward scan reads that as AllDamage being consumed there.
        """
        pattern = MOVZ_W1 | (bonus_id << 5) | 1
        found = {}
        for segment in segments:
            base, data = segment['p_vaddr'], segment.data()
            words = struct.unpack_from(f'<{len(data)//4}I', data, 0)
            for index, word in enumerate(words):
                if bl_target(word, base + index*4) != GET_BONUS:
                    continue
                call = base + index*4
                for step in range(1, CALL_WINDOW + 1):
                    if index - step < 0:
                        break
                    previous = words[index-step]
                    at = call - step*4
                    if bl_target(previous, at) is not None:
                        break          # an intervening call owns w1 from here back
                    if previous == pattern:
                        found.setdefault(owner(at), []).append(hex(at))
                        break
                    if previous >> 24 == 0x52 and (previous & 0x1F) == 1:
                        break          # w1 was written with some other immediate
        return found

    # The control group first: if these come back empty the sweep is broken, not the game.
    controls = {}
    for bonus_id, label in CONTROLS.items():
        readers = bonus_readers(bonus_id)
        if not readers:
            raise ValueError(f'control bonus {label} has no reader, so the sweep is not working')
        controls[label] = {'bonusType': bonus_id, 'readers': sorted(filter(None, readers))}
    for label, expected in (('SwordMasterDamage', 'PlayerModel$$GetSwordMasterDamage'),
                            ('TapDamage', 'PlayerModel$$GetTapFromHelpers')):
        if expected not in controls[label]['readers']:
            raise ValueError(f'{label} is no longer read by {expected}')

    crit_readers = bonus_readers(CRIT_DAMAGE)
    if sorted(filter(None, crit_readers)) != [CRIT_DAMAGE_READER]:
        raise ValueError(f'CritDamage readers changed: {sorted(filter(None, crit_readers))}')

    # RefreshCriticalValues: chance from two bonuses and a cap, multiplier from a static and one bonus.
    critical = text(REFRESH_CRITICAL)
    for number, label in ((CRIT_CHANCE, 'CritChance'), (ALL_PROBABILITY_BOOST, 'AllProbabilityBoost'),
                          (CRIT_DAMAGE, 'CritDamage')):
        if not any(re.fullmatch(rf'mov w1, #{number:#x}', line) for line in critical):
            raise ValueError(f'RefreshCriticalValues no longer reads {label}')
    for offset, label in ((CRIT_MULT, 'playerCritMult'), (MAX_CRIT_CHANCE, 'maxCritChance')):
        if not any(re.fullmatch(rf'ldr s\d+, \[x\d+, #{offset:#x}\]', line) for line in critical):
            raise ValueError(f'RefreshCriticalValues no longer reads {label}')
    if calls(REFRESH_CRITICAL).count('GHDouble$$op_Multiply') < 3:
        raise ValueError('RefreshCriticalValues no longer has all three products')
    # The third step, missed on the first pass: while the crit boost skill runs, the multiplier is
    # multiplied again. The skill id is an immediate handed to IsSkillActive, so it is read the same
    # way a bonus id is - getting it wrong would attach the boost to the wrong skill.
    # Checking only that the immediate appears is too weak: this method reads several ids, so a
    # wrong constant can still be "found" among them. The whole sequence is pinned instead.
    data = body(REFRESH_CRITICAL)
    words = struct.unpack_from(f'<{len(data)//4}I', data, 0)
    read_here = []
    for index, word in enumerate(words):
        if bl_target(word, REFRESH_CRITICAL + index*4) != GET_BONUS:
            continue
        for step in range(1, 17):
            if index - step < 0:
                break
            previous, at = words[index-step], REFRESH_CRITICAL + (index-step)*4
            if bl_target(previous, at) is not None:
                break
            if previous >> 24 == 0x52 and (previous & 0x1F) == 1:
                read_here.append((previous >> 5) & 0xFFFF)
                break
    expected = [CRIT_CHANCE, ALL_PROBABILITY_BOOST, CRIT_DAMAGE, CRIT_BOOST_SKILL_CRIT_DAMAGE]
    if read_here != expected:
        raise ValueError(f'RefreshCriticalValues reads {read_here}, expected {expected}')
    if 'ActiveSkillModel$$IsSkillActive' not in calls(REFRESH_CRITICAL):
        raise ValueError('the crit boost step no longer checks whether the skill is running')
    skill_ids = [int(line.split('#')[1], 16) for line in critical
                 if re.fullmatch(r'mov w1, #\d+', line) or re.fullmatch(r'mov w1, #0x[0-9a-f]+', line)]
    if CRIT_BOOST_SKILL_ID not in skill_ids:
        raise ValueError(f'the skill checked is no longer ActiveSkillID {CRIT_BOOST_SKILL_ID}')

    # GetSwordMasterDamage: five multiplies over three bonuses, one static factor, one floor.
    sword = text(GET_SWORD_MASTER)
    for number, label in ((SWORD_MASTER_DAMAGE, 'SwordMasterDamage'), (TAP_DAMAGE, 'TapDamage'),
                          (ALL_DAMAGE, 'AllDamage')):
        if not any(re.fullmatch(rf'mov w1, #{number:#x}', line) for line in sword):
            raise ValueError(f'GetSwordMasterDamage no longer reads {label}')
    if any(re.fullmatch(rf'mov w1, #{CRIT_DAMAGE:#x}', line) for line in sword):
        raise ValueError('GetSwordMasterDamage now reads CritDamage')
    if not any(re.fullmatch(rf'ldr s\d+, \[x\d+, #{PLAYER_DAMAGE_MULT:#x}\]', line) for line in sword):
        raise ValueError('GetSwordMasterDamage no longer reads playerDamageMult')
    sword_calls = calls(GET_SWORD_MASTER)
    if sword_calls.count('GHDouble$$op_Multiply') != 5:
        raise ValueError(f'the sword master term is no longer five multiplies: '
                         f'{sword_calls.count("GHDouble$$op_Multiply")}')
    for name in ('PlayerModel$$GetImprovementBonus', 'GHDouble$$Max'):
        if name not in sword_calls:
            raise ValueError(f'GetSwordMasterDamage no longer uses {name}')

    # Titan/Boss damage stay on the attack path, where every source pays them.
    attack = text(PERFORM_ATTACK)
    for number, label in ((TITAN_DAMAGE, 'TitanDamage'), (BOSS_DAMAGE, 'BossDamage')):
        if not any(re.fullmatch(rf'mov w1, #{number:#x}', line) for line in attack):
            raise ValueError(f'PerformAttackMonster no longer reads {label}')

    defaults = json.loads((ROOT/'reference/tt2/8.2.0/servervar-defaults.json')
                          .read_text(encoding='utf-8'))['recovered']
    by_offset = {int(fact['offset'], 16): (name, fact) for name, fact in defaults.items()}
    statics = {}
    for offset in (BASE_CRIT_CHANCE, CRIT_MULT, MAX_CRIT_CHANCE, PLAYER_DAMAGE_MULT):
        if offset not in by_offset:
            raise ValueError(f'no recovered server variable at {offset:#x}')
        name, fact = by_offset[offset]
        statics[name] = {'offset': fact['offset'], 'type': fact['type'],
                         'defaultValue': fact['value'], 'status': 'default'}
    if 'playerCritMult' not in statics or statics['playerCritMult']['defaultValue'] != 11.5:
        raise ValueError('playerCritMult is no longer 11.5')

    document = {
        'version': '8.2.0',
        'role': '暴擊傷害加成只用在暴擊倍率：全映像只有一個讀取點，一般傷害那條路完全沒有它。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': 'BonusType.CritDamage（134）在整個映像只有 PlayerModel.RefreshCriticalValues 一個 '
                   'GetBonus 呼叫點，而且只用來算暴擊倍率＝playerCritMult × Bonus(CritDamage)。'
                   '同一趟掃描的三個對照加成（SwordMasterDamage、TapDamage、AllDamage）都掃得到既知讀取點，'
                   '所以「只有一處」不是掃描失效。'
                   'PlayerModel.GetSwordMasterDamage 的乘數依序是 等級 × GetImprovementBonus(等級) × '
                   'playerDamageMult × Bonus(SwordMasterDamage) × Bonus(TapDamage) × Bonus(AllDamage)，'
                   '五次乘法、一次 Max 取下限，沒有暴擊項。'
                   'TitanDamage 與 BossDamage 則留在 StageLogic.PerformAttackMonster，'
                   '也就是每個傷害來源結算時都會付的那一段。',
        'expression': '暴擊倍率 = playerCritMult × Bonus(CritDamage)'
                      '（暴擊增幅技能執行中再 × Bonus(CritBoostSkillCritDamage)）；'
                      '暴擊機率 = min(maxCritChance, Bonus(CritChance) × Bonus(AllProbabilityBoost))；'
                      '劍術大師傷害 = max(下限, 等級 × 改良加成 × playerDamageMult × SwordMasterDamage × '
                      'TapDamage × AllDamage)',
        'methods': {name: hex(address) for address, name in IDENTITIES.items()},
        'critDamageReaders': sorted(filter(None, crit_readers)),
        'critBoostStep': {'bonus': 'CritBoostSkillCritDamage',
                          'bonusType': CRIT_BOOST_SKILL_CRIT_DAMAGE,
                          'skill': 'ActiveSkillID.CritBoost',
                          'skillId': CRIT_BOOST_SKILL_ID,
                          'note': 'RefreshCriticalValues 的第三段：只有在暴擊增幅技能執行中才乘上去。'
                                  '2.14.2 第一次解這個方法時只讀了前兩段，這一項是 2.15.4 補上的。'},
        'critDamageCallSites': {name: sites for name, sites in crit_readers.items() if name},
        'controls': controls,
        'serverVars': statics,
        'consequence': '引擎把 CritDamage 乘進 buildMultiplier，等於每一種傷害都吃暴擊傷害加成，'
                       '暴擊時還會再乘一次（critMultiplier 本來就有）。'
                       '原生沒有這回事：一般傷害不吃，暴擊只乘一次。'
                       '2.14.2 起把那一份從 buildMultiplier 移除；沒有任何 CritDamage 來源的存檔不受影響。',
        'limits': ['方法存在、位址與其 GetBonus 呼叫點是事實；靜態值引用的是編譯期預設值，線上可覆蓋',
                   '本表只涵蓋暴擊與劍術大師兩條路徑，其他流派的傷害算式尚未逐一還原'],
    }
    target = ROOT/'reference/tt2/8.2.0/critical-damage-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print('Verified the critical-damage boundary: CritDamage has '
          f'{len(document["critDamageReaders"])} reader ({document["critDamageReaders"][0]}), '
          f'{len(controls)} control bonuses all found, playerCritMult = '
          f'{statics["playerCritMult"]["defaultValue"]}')


if __name__ == '__main__':
    main()
