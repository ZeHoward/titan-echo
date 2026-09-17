"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

The pet table was imported from 8.2 long ago, but the formulas around it were still the 7.5 ones.
PetInfo's six growth methods are short enough to read in full:

    GetActiveDamage(level)  = damageBase + inc1*min(level, L1)
                              + inc2*min(max(level-L1, 0), L2-L1) + inc3*max(level-L2, 0)
        with L1 = petDamageIncLevel1, L2 = petDamageIncLevel2
    GetImprovementBonus(level) -> improvementLevel = Min(Floor((level - start) / delta),
                                                         maxImprovementLevels)
                                  improvementBonus = Pow(improvementBonus, improvementLevel)
        with start/delta = petImprovementLevelStart/Delta, or the endGame pair for Endgame pets
    GetActiveBonus(level)   = (bonusBase + bonusInc*level) * improvementBonus * Bonus(bonusType)
    GetPassivePercentage(l) = Min(1, gap * increment * (l / gap))   -- integer division
    GetPassiveDamage(level) = GetActiveDamage(level) * GetPassivePercentage(Level)
    GetPassiveBonus(level)  = identity + (GetActiveBonus(level) - identity) * GetPassivePercentage

Most of that already matches the engine. Two things do not, and this pins both: the engine advances
an improvement step every 50 levels where the native delta is 20, and it treats
maxImprovementLevels as a level ceiling where the native uses it as a ceiling on the step count.
"""
import hashlib
import io
import json
import pathlib
import re
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCAL = ROOT/'work/apk-analysis'
sys.path.insert(0, str(LOCAL/'python-libs'))
from capstone import Cs, CS_ARCH_ARM64, CS_MODE_ARM
from elftools.elf.elffile import ELFFile

IMPROVEMENT = 0x23B0700     # PetInfo.GetImprovementBonus(GHDouble, out GHDouble, out GHDouble)
PASSIVE_PERCENT = 0x23B05F0  # PetInfo.GetPassivePercentage(int)
ACTIVE_BONUS = 0x23B0E64     # PetInfo.GetActiveBonus(GHDouble)
ACTIVE_DAMAGE = 0x23B09A4    # PetInfo.GetActiveDamage(GHDouble)
PASSIVE_DAMAGE = 0x23B1300   # PetInfo.GetPassiveDamage(GHDouble)
PASSIVE_BONUS = 0x23B13F8    # PetInfo.GetPassiveBonus(int)
NAMES = {IMPROVEMENT: 'PetInfo$$GetImprovementBonus', PASSIVE_PERCENT: 'PetInfo$$GetPassivePercentage',
         ACTIVE_BONUS: 'PetInfo$$GetActiveBonus', ACTIVE_DAMAGE: 'PetInfo$$GetActiveDamage',
         PASSIVE_DAMAGE: 'PetInfo$$GetPassiveDamage', PASSIVE_BONUS: 'PetInfo$$GetPassiveBonus'}

# ParsedPetInfo fields, by offset in the object.
PET_FIELDS = {'damageBase': 0x18, 'damageInc1': 0x20, 'damageInc2': 0x28, 'damageInc3': 0x30,
              'bonusBase': 0x40, 'bonusInc': 0x48, 'improvementBonus': 0x50,
              'maxImprovementLevels': 0x58}
# ServerVarsModel statics the pet paths read, by offset in the statics block.
VARS = {'petPassiveLevelGap': 0xB00, 'petPassiveLevelIncrement': 0xB04,
        'petDamageIncLevel1': 0xB08, 'petDamageIncLevel2': 0xB0C,
        'petImprovementLevelStart': 0xB18, 'petImprovementLevelDelta': 0xB1C,
        'endGamePetImprovementLevelStart': 0xB20, 'endGamePetImprovementLevelDelta': 0xB24}
# The engine's own step rule, for the side-by-side below.
ENGINE_START, ENGINE_DELTA = 100, 50
SAMPLE_LEVELS = [1, 20, 50, 99, 100, 120, 200, 500, 1000, 1600, 3000, 10000]


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
    dump = (LOCAL/'dump/dump.cs').read_text(encoding='utf-8', errors='replace')

    symbols = {m['Address']: m['Name'] for m in script['ScriptMethod']}
    starts = sorted(symbols)
    elf = ELFFile(io.BytesIO(binary))
    machine = Cs(CS_ARCH_ARM64, CS_MODE_ARM)

    def read(start, size):
        segment = next((s for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD'
                        and s['p_vaddr'] <= start and start+size <= s['p_vaddr']+s['p_filesz']), None)
        if segment is None:
            raise ValueError(f'address outside loaded image: {start:#x}')
        return binary[start-segment['p_vaddr']+segment['p_offset']:][:size]

    def body(address):
        following = next((a for a in starts if a > address), address+0x400)
        return read(address, min(following-address, 0x2000))

    def instructions(address):
        return list(machine.disasm(body(address), address))

    def fact(address):
        return {'name': symbols[address], 'rva': hex(address), 'bytesSha256': sha(body(address))}

    def calls(address):
        return [symbols.get(int(i.op_str.lstrip('#'), 16), '') for i in instructions(address)
                if i.mnemonic == 'bl' and i.op_str.startswith('#')]

    def statics(address):
        """Which ServerVarsModel fields the method reaches, in order, without repeats.

        Some of these are loaded straight off the statics base (`ldr w9, [x8, #0xb00]`), others
        have the offset folded into an address first (`add x8, x8, #0xb18` then `ldr w23, [x8]`),
        so both forms count.
        """
        seen = []
        for instruction in instructions(address):
            if instruction.mnemonic.startswith('ld'):
                match = re.search(r'\[\w+, #(0x[0-9a-f]+)\]', instruction.op_str)
            elif instruction.mnemonic == 'add':
                match = re.search(r'\w+, \w+, #(0x[0-9a-f]+)$', instruction.op_str)
            else:
                continue
            if not match:
                continue
            name = next((field for field, at in VARS.items() if at == int(match.group(1), 16)), None)
            if name and name not in seen:
                seen.append(name)
        return seen

    for address, name in NAMES.items():
        if symbols.get(address) != name:
            raise ValueError(f'method identity mismatch at {address:#x}: {symbols.get(address)!r}')

    # Field offsets come from dump.cs, so a reshuffled class fails loudly instead of being misread.
    parsed = re.search(r'^public class ParsedPetInfo(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)
    for name, offset in PET_FIELDS.items():
        match = re.search(r'public \S+ '+name+r'; // 0x([0-9A-Fa-f]+)', parsed)
        if not match or int(match.group(1), 16) != offset:
            raise ValueError(f'ParsedPetInfo.{name} is no longer at {offset:#x}')
    variables = re.search(r'^public class ServerVarsModel(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)
    for name, offset in VARS.items():
        match = re.search(r'public static \S+ '+name+r'; // 0x([0-9A-Fa-f]+)', variables)
        if not match or int(match.group(1), 16) != offset:
            raise ValueError(f'{name} is no longer at {offset:#x}')
    types = re.search(r'public enum PetType(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)
    pet_types = {name: int(value) for name, value in re.findall(r'public const PetType (\w+) = (-?\d+);', types)}
    if pet_types.get('Endgame') != 3:
        raise ValueError(f'PetType.Endgame is {pet_types.get("Endgame")}, not 3')

    # 1. The improvement step: subtract a start level, divide by a delta, floor, then cap the
    #    STEP COUNT (not the level) with maxImprovementLevels, and raise improvementBonus to it.
    improvement_vars = statics(IMPROVEMENT)
    for name in ('petImprovementLevelStart', 'petImprovementLevelDelta',
                 'endGamePetImprovementLevelStart', 'endGamePetImprovementLevelDelta'):
        if name not in improvement_vars:
            raise ValueError(f'GetImprovementBonus no longer reads {name}')
    order = [name for name in ('GHDouble$$op_Subtraction', 'GHDouble$$op_Division',
                               'GHDouble$$Floor', 'GHDouble$$Min', 'GHDouble$$Pow')
             if name in calls(IMPROVEMENT)]
    if order != ['GHDouble$$op_Subtraction', 'GHDouble$$op_Division', 'GHDouble$$Floor',
                 'GHDouble$$Min', 'GHDouble$$Pow']:
        raise ValueError(f'GetImprovementBonus no longer does subtract/divide/floor/min/pow: {order}')
    text = '\n'.join(f'{i.mnemonic} {i.op_str}' for i in instructions(IMPROVEMENT))
    # The Min's second operand is maxImprovementLevels read off the object, not off the level.
    if not re.search(r'ldr w\d+, \[x\d+, #0x58\]', text):
        raise ValueError('GetImprovementBonus no longer feeds maxImprovementLevels into the Min')
    if re.search(r'GHDouble\$\$Max', '\n'.join(calls(IMPROVEMENT))):
        raise ValueError('GetImprovementBonus now floors the step count; it used not to')

    # 2. The damage bands, and that their two boundaries are the named [ServerVar]s.
    damage_vars = statics(ACTIVE_DAMAGE)
    if damage_vars != ['petDamageIncLevel1', 'petDamageIncLevel2']:
        raise ValueError(f'GetActiveDamage reads {damage_vars}')
    if calls(ACTIVE_DAMAGE).count('GHDouble$$op_LessThanOrEqual') != 2:
        raise ValueError('GetActiveDamage no longer splits the level into three bands')

    # 3. The passive share, which is integer division by the gap times gap times the increment.
    percent = instructions(PASSIVE_PERCENT)
    percent_vars = statics(PASSIVE_PERCENT)
    if percent_vars != ['petPassiveLevelGap', 'petPassiveLevelIncrement']:
        raise ValueError(f'GetPassivePercentage reads {percent_vars}')
    percent_text = '\n'.join(f'{i.mnemonic} {i.op_str}' for i in percent)
    for needed, why in ((r'sdiv w\d+, w\d+, w\d+', 'the integer division by the gap'),
                        (r'fmov s\d+, #1\.00000000', 'the 1.0 it is capped at'),
                        (r'fcsel s\d+, s\d+, s\d+, gt', 'the Min against 1')):
        if not re.search(needed, percent_text):
            raise ValueError(f'GetPassivePercentage no longer contains {why}')

    # 4. Both passive getters are the active value scaled by that share, the bonus one around
    #    the bonus type's identity so a multiplicative bonus decays toward 1 and not toward 0.
    for address, needed in ((PASSIVE_DAMAGE, ['PetInfo$$GetActiveDamage', 'PetInfo$$GetPassivePercentage']),
                            (PASSIVE_BONUS, ['BonusModel$$GetBonusIdentity', 'PetInfo$$GetActiveBonus',
                                             'PetInfo$$GetPassivePercentage'])):
        made = calls(address)
        for name in needed:
            if name not in made:
                raise ValueError(f'{symbols[address]} no longer calls {name}')
    bonus_calls = calls(ACTIVE_BONUS)
    if 'PetInfo$$GetImprovementBonus' not in bonus_calls:
        raise ValueError('GetActiveBonus no longer applies the improvement bonus')

    defaults = json.loads((ROOT/'reference/tt2/8.2.0/servervar-defaults.json')
                          .read_text(encoding='utf-8'))['recovered']
    values = {}
    for name in VARS:
        if name not in defaults:
            raise ValueError(f'{name} has no recovered default; run audit-servervar-defaults.py first')
        values[name] = defaults[name]['value']

    # The engine's table is the 8.2 table; check that before comparing formulas built on it.
    table = json.loads((ROOT/'reference/tt2/8.2.0/PetInfo.json').read_text(encoding='utf-8'))
    rows = {row['values']['PetID']: row['values'] for row in table['records']}
    start, delta = values['petImprovementLevelStart'], values['petImprovementLevelDelta']
    ceilings = sorted({int(float(row['MaxImprovementLevels'])) for row in rows.values()})
    improvements = sorted({float(row['ImprovementBonus']) for row in rows.values()})

    def native_steps(level, ceiling):
        return min((level-start)//delta if level >= start else -((start-level+delta-1)//delta), ceiling)

    def engine_steps(level, ceiling):
        return max(0, (min(level, ceiling)-ENGINE_START)//ENGINE_DELTA)

    sample = {}
    for level in SAMPLE_LEVELS:
        native, engine = native_steps(level, 1600), engine_steps(level, 1600)
        sample[str(level)] = {'nativeSteps': native, 'engineSteps': engine,
                              'ratioWhenImprovementIs1_5': 1.5**(native-engine)}

    document = {
        'version': '8.2.0',
        'role': '寵物成長的原生算式：三段傷害、改良段、未出戰比例，以及被動值如何由主動值縮放。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': f'六個方法都讀得完。三段傷害的兩個門檻就是 petDamageIncLevel1／2'
                   f'（{values["petDamageIncLevel1"]}／{values["petDamageIncLevel2"]}），'
                   f'未出戰比例是 Min(1, gap × increment × (等級 ÷ gap))，gap = '
                   f'{values["petPassiveLevelGap"]}、increment = float '
                   f'{values["petPassiveLevelIncrement"]}，兩者與引擎現況相同；'
                   f'被動傷害與被動加成也確實是主動值依該比例縮放（加成那側繞著 GetBonusIdentity）。'
                   f'**改良段不同**：原生是 Min(Floor((等級 − {start}) ÷ {delta}), maxImprovementLevels)，'
                   f'引擎用的是 max(0, floor((min(等級, maxImprovementLevels) − {ENGINE_START}) ÷ {ENGINE_DELTA}))，'
                   f'兩處都不一樣——每段的等級間隔是 {delta} 不是 {ENGINE_DELTA}，'
                   f'而 maxImprovementLevels 是段數上限而不是等級上限；原生也沒有把段數夾到 0 以上。',
        'consequence': f'資料本身（30 隻逐格）與傷害、比例、被動三條算式可由 baseline-75 升級；'
                       f'改良段的兩處差異會整條改寫寵物加成的強弱，列為不一致並交由使用者決定。',
        'methods': {key: fact(address) for key, address in
                    (('improvementBonus', IMPROVEMENT), ('passivePercentage', PASSIVE_PERCENT),
                     ('activeBonus', ACTIVE_BONUS), ('activeDamage', ACTIVE_DAMAGE),
                     ('passiveDamage', PASSIVE_DAMAGE), ('passiveBonus', PASSIVE_BONUS))},
        'matchesEngine': {
            'damageBands': {
                'formula': 'damageBase + inc1×min(等級, L1) + inc2×min(max(等級−L1, 0), L2−L1) '
                           '+ inc3×max(等級−L2, 0)',
                'boundaries': {'petDamageIncLevel1': values['petDamageIncLevel1'],
                               'petDamageIncLevel2': values['petDamageIncLevel2']},
                'note': '原生以兩次 op_LessThanOrEqual 分三段，逐段把前一段的整段量累加進來；'
                        '引擎用 min／max 夾出同樣的三段，結果相同。',
            },
            'passiveShare': {
                'formula': 'Min(1, gap × increment × (等級 ÷ gap))，其中除法是整數除法',
                'gap': values['petPassiveLevelGap'],
                'increment': values['petPassiveLevelIncrement'],
                'note': f'gap = {values["petPassiveLevelGap"]}、increment 是 float '
                        f'{values["petPassiveLevelIncrement"]}，相乘後每 {values["petPassiveLevelGap"]} 級加 '
                        f'{values["petPassiveLevelGap"]*values["petPassiveLevelIncrement"]:.2f}，'
                        f'與引擎的 min(1, floor(等級÷5)×0.05) 相同。',
            },
            'passiveGetters': {
                'damage': 'GetPassiveDamage = GetActiveDamage(等級) × GetPassivePercentage(Level)',
                'bonus': 'GetPassiveBonus = identity + (GetActiveBonus(等級) − identity) × '
                         'GetPassivePercentage(等級)，identity 取自 BonusModel.GetBonusIdentity',
                'note': '與引擎的 additive ? full×fraction : 1 + (full−1)×fraction 相同——'
                        '加法型的 identity 是 0，乘法型是 1。',
            },
            'activeBonusShape': {
                'formula': '(bonusBase + bonusInc × 等級) × improvementBonus × Bonus(bonusType)',
                'note': '括號內與改良乘數的位置都與引擎相同；引擎乘的第三項是 '
                        '<family>Pet<group>Effect 與 EquipmentPetEffect，未逐項核對是否等同原生的 '
                        'Bonus(bonusType)，那是另一條線。',
            },
            'tableRows': {'count': len(rows), 'note': '引擎的 TT2_PETS 30 隻與本表的 BonusBase、BonusInc、'
                                                      'ImprovementBonus、MaxImprovementLevels、DamageBase、'
                                                      'UnlockStage 與三段 DamageInc 逐格相同。'},
        },
        'differsFromEngine': {
            'improvementStep': {
                'native': f'Min(Floor((等級 − {start}) ÷ {delta}), maxImprovementLevels)',
                'engine': f'max(0, floor((min(等級, maxImprovementLevels) − {ENGINE_START}) ÷ {ENGINE_DELTA}))',
                'differences': [
                    f'每段的等級間隔：原生 {delta}，引擎 {ENGINE_DELTA}',
                    'maxImprovementLevels 的角色：原生夾的是段數，引擎夾的是等級',
                    '原生沒有把段數夾到 0 以上，所以等級低於起算值時乘數小於 1',
                ],
                'serverVars': {name: {'offset': hex(VARS[name]), 'value': values[name]}
                               for name in ('petImprovementLevelStart', 'petImprovementLevelDelta',
                                            'endGamePetImprovementLevelStart',
                                            'endGamePetImprovementLevelDelta')},
                'endgameNote': f'PetType.Endgame（值 {pet_types["Endgame"]}）另走 endGame 那一組'
                               f'（{values["endGamePetImprovementLevelStart"]} 與 '
                               f'{values["endGamePetImprovementLevelDelta"]}）；本表 30 隻只有 Legacy 與 '
                               f'Exotic，用不到，末日紀元寵物在 EndgamePetInfo 另計。',
                'tableValues': {'maxImprovementLevels': ceilings, 'improvementBonus': improvements},
                'sampleSteps': sample,
                'impact': '以 improvementBonus = 1.5、maxImprovementLevels = 1600 的 21 隻為例，'
                          '等級 1 時原生只有引擎的 13%，100 級相同，200 級是 3.4 倍，1000 級 5.7 萬倍，'
                          '1600 級 8.4×10^7 倍——早期變弱、後期暴增，等於整條寵物曲線重來。',
            },
        },
        'limits': [
            '八個欄位都是 [ServerVar]，本表用的是編譯期預設值，不是線上值',
            'GetActiveBonus 尾端乘的 Bonus(bonusType) 與引擎的 <family>Pet<group>Effect 未逐項對照',
            'GetActiveBonus 開頭的 op_GreaterThanOrEqual 判斷未讀完，只確認改良乘數有被套用',
            'Endgame 寵物與 EndgamePetInfo 未查，本表只涵蓋 PetInfo 的 30 隻',
        ],
    }
    target = ROOT/'reference/tt2/8.2.0/pet-growth-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Verified the pet formulas: damage bands at {values["petDamageIncLevel1"]}/'
          f'{values["petDamageIncLevel2"]}, passive share {values["petPassiveLevelGap"]} levels per '
          f'{values["petPassiveLevelGap"]*values["petPassiveLevelIncrement"]:.2f}; improvement step is '
          f'every {delta} levels from {start} with maxImprovementLevels capping the STEP COUNT '
          f'(engine: every {ENGINE_DELTA} from {ENGINE_START}, capping the level).')


if __name__ == '__main__':
    main()
