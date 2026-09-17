"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

An earlier pass got two of the three terms of the relic curve and left the third — the one with a
Math.Min inside a Math.Pow — unread. All three are readable. PrestigeModel.GetBonusRelicsFromStageCount
clamps the stage and adds three terms:

    stage = Min(stage, relicsStageMax)
    term1 = relicStageMult2 * (relicStageOffset + stage)
    term2 = relicStageMult1 * relicStageBase ^ (stage ^ relicStageExpo)
    expo  = Min(relicStageExpoMax3,
                relicStageExpo2 * (1 + relicStageMult3 * stage ^ relicStageExpo3))
    term3 = relicStageBase2 ^ (stage ^ expo)
    return Max(0, term1 + term2 + term3)

All ten coefficients have compiled-in defaults, so the curve can be evaluated and compared with the
engine's 7.5 approximation of stage^1.7 / 100. The comparison is the point: they agree to within a
factor of four up to stage 2000 and then diverge without limit, because term3's exponent creeps up
to its own ceiling and 1.002^(stage^1.0155) takes over.
"""
import hashlib
import io
import json
import math
import pathlib
import re
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCAL = ROOT/'work/apk-analysis'
sys.path.insert(0, str(LOCAL/'python-libs'))
from capstone import Cs, CS_ARCH_ARM64, CS_MODE_ARM
from elftools.elf.elffile import ELFFile

BONUS_RELICS = 0x23FF6CC      # PrestigeModel.GetBonusRelicsFromStageCount(int stage)
TOTAL_RELICS = 0x23FF300      # PrestigeModel.GetTotalRelicsFromStageCount(int, bool)
GET_BONUS = 0x2714C88         # BonusModel.GetBonus(BonusType, ...)
MATH_POW = 0x3FCC8E0          # System.Math.Pow(double, double)
MATH_MIN = 0x3FCC214          # System.Math.Min(double, double)
MATH_MAX = 0x3FCC0F4          # System.Math.Max(int, int)
CURRENT_ADDITIVE = 0x23F005C  # PrestigeModel.GetCurrentAdditiveRelicMultiplierBonus()
REWARDABLE = 0x23FF64C        # PrestigeModel.GetRewardableAdditiveRelicMultiplierAmount()
NEXT_ADDITIVE = 0x2400624     # PrestigeModel.GetNextAdditiveRelicMultiplier(out bool)
NAMES = {BONUS_RELICS: 'PrestigeModel$$GetBonusRelicsFromStageCount',
         TOTAL_RELICS: 'PrestigeModel$$GetTotalRelicsFromStageCount',
         CURRENT_ADDITIVE: 'PrestigeModel$$GetCurrentAdditiveRelicMultiplierBonus',
         REWARDABLE: 'PrestigeModel$$GetRewardableAdditiveRelicMultiplierAmount'}
# PrestigeModel's own field, the count of additive relic multipliers the player owns.
OWNED_FIELD = ('AdditiveRelicMultiplier', 0x48)
# ServerVarsModel statics, by offset in the statics block.
VARS = {'relicStageMult1': 0x168, 'relicStageMult2': 0x170, 'relicStageMult3': 0x178,
        'relicStageBase': 0x180, 'relicStageBase2': 0x188, 'relicStageExpo': 0x190,
        'relicStageExpo2': 0x198, 'relicStageExpo3': 0x1A0, 'relicStageExpoMax3': 0x1A8,
        'relicStageOffset': 0x1B0, 'relicsStageMax': 0x214}
# Only the outer method reads this one, as the per-stage part of the additive multiplier.
OUTER_VAR = ('stageRushToRelicMultiplier', 0xC54)
SAMPLE_STAGES = [60, 100, 250, 500, 1000, 2000, 5000, 10000, 30000, 98000]
ENGINE_EXPO, ENGINE_DIVISOR = 1.7, 100


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

    for address, name in NAMES.items():
        if symbols.get(address) != name:
            raise ValueError(f'method identity mismatch at {address:#x}: {symbols.get(address)!r}')
    for address, fragment in ((GET_BONUS, 'GetBonus'), (MATH_POW, 'Pow'), (MATH_MIN, 'Min')):
        if fragment not in symbols.get(address, ''):
            raise ValueError(f'{address:#x} is not the expected {fragment}: {symbols.get(address)!r}')

    variables = re.search(r'^public class ServerVarsModel(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)
    for name, offset in VARS.items():
        match = re.search(r'public static \S+ '+name+r'; // 0x([0-9A-Fa-f]+)', variables)
        if not match or int(match.group(1), 16) != offset:
            raise ValueError(f'{name} is no longer at {offset:#x}')

    listing = instructions(BONUS_RELICS)
    steps = []
    for index, instruction in enumerate(listing):
        operands = f'{instruction.mnemonic} {instruction.op_str}'
        if instruction.mnemonic in ('bl', 'b') and instruction.op_str.startswith('#'):
            target = int(instruction.op_str.lstrip('#'), 16)
            name = symbols.get(target, '')
            if name and 'Singleton' not in name:
                steps.append(('call', name, instruction.address))
            continue
        # Only loads off a real object base count as a coefficient; the stack reuses these offsets.
        # `ldp d1, d9, [x8, #0x1a0]` takes two adjacent coefficients in one go, so a pair load
        # counts as reading both its offset and the next one along.
        pair = re.match(r'ldp ([dqx])\d+, [dqx]\d+, \[(x\d+), #(0x[0-9a-f]+)\]', operands)
        match = pair or re.match(r'ld\w* [dqxw]\d+, \[(x\d+), #(0x[0-9a-f]+)\]', operands)
        if match:
            if pair:
                width = {'d': 8, 'x': 8, 'q': 16}[pair.group(1)]
                offsets = [int(pair.group(3), 16), int(pair.group(3), 16)+width]
            else:
                offsets = [int(match.group(2), 16)]
            for offset in offsets:
                name = next((field for field, at in VARS.items() if at == offset), None)
                if name:
                    steps.append(('var', name, instruction.address))
            continue
        if instruction.mnemonic in ('fmul', 'fadd', 'csel', 'fmov'):
            steps.append(('op', operands, instruction.address))

    def order(kind):
        return [name for tag, name, _ in steps if tag == kind]

    # 1. The stage is clamped to relicsStageMax before anything else touches it.
    coefficients = order('var')
    if coefficients[0] != 'relicsStageMax':
        raise ValueError(f'the first coefficient read is {coefficients[0]}, not relicsStageMax')
    if not any(instruction.mnemonic == 'csel' and instruction.op_str.endswith('lt')
               for instruction in listing):
        raise ValueError('the stage is no longer clamped with a csel')

    # 2. Every one of the ten coefficients is reached, and Math.Pow runs three times with a
    #    Math.Min between the second and third — that Min is the third term's exponent ceiling.
    missing = [name for name in VARS if name not in coefficients]
    if missing:
        raise ValueError(f'these coefficients are no longer read: {missing}')
    calls = order('call')
    powers = [name for name in calls if name in ('System.Math$$Pow', 'GHDouble$$Pow')]
    if powers != ['System.Math$$Pow', 'System.Math$$Pow', 'System.Math$$Pow',
                  'System.Math$$Pow', 'GHDouble$$Pow']:
        raise ValueError(f'the power calls are now {powers}')
    if 'System.Math$$Min' not in calls:
        raise ValueError('the third exponent is no longer capped with Math.Min')
    if calls.index('System.Math$$Min') >= calls.index('GHDouble$$Pow'):
        raise ValueError('the Min no longer happens before the GHDouble.Pow it feeds')
    # 3. Three terms are summed and the sum is floored at zero.
    if calls.count('GHDouble$$op_Addition') != 2:
        raise ValueError(f'{calls.count("GHDouble$$op_Addition")} additions, expected 2 for 3 terms')
    if calls[-1] != 'GHDouble$$Max':
        raise ValueError(f'the method no longer ends in GHDouble.Max: {calls[-1]}')
    # The 1.0 that the third exponent's inner sum adds is an immediate, not a coefficient.
    if not any(instruction.mnemonic == 'fmov' and instruction.op_str.endswith('#1.00000000')
               for instruction in listing):
        raise ValueError('the 1 + ... inside the third exponent is gone')

    # 4. The outer method multiplies by three named bonuses and rounds up.
    outer = instructions(TOTAL_RELICS)
    asked = []
    for index, instruction in enumerate(outer):
        if (instruction.mnemonic != 'bl' or not instruction.op_str.startswith('#')
                or int(instruction.op_str.lstrip('#'), 16) != GET_BONUS):
            continue
        argument = next((int(earlier.op_str.split('#')[1], 0) for earlier in reversed(outer[:index])
                         if earlier.mnemonic == 'mov'
                         and re.fullmatch(r'w1, #\d+|w1, #0x[0-9a-f]+', earlier.op_str)), None)
        asked.append(argument)
    types = re.search(r'public enum BonusType(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)
    bonus_names = {int(value): name for name, value
                   in re.findall(r'public const BonusType (\w+) = (\d+);', types)}
    multipliers = [bonus_names.get(value) for value in asked]
    if multipliers != ['PrestigeRelic', 'PrestigeRelicAdditive', 'OnlyPrestigeRelic']:
        raise ValueError(f'the outer multipliers are now {multipliers}')
    outer_calls = [symbols.get(int(i.op_str.lstrip('#'), 16), '') for i in outer
                   if i.mnemonic in ('bl', 'b') and i.op_str.startswith('#')]
    for name in (NAMES[BONUS_RELICS], 'GHDouble$$Ceiling'):
        if name not in outer_calls:
            raise ValueError(f'GetTotalRelicsFromStageCount no longer calls {name}')
    # The order the multipliers are applied in. Following the GHDouble out-pointers through the
    # stack gives the association; this pins the sequence those out-pointers appear in, which is
    # what makes the association readable in the first place.
    interesting = [name for name in outer_calls if name in (
        'PrestigeModel$$GetCurrentAdditiveRelicMultiplierBonus',
        'PrestigeModel$$GetRewardableAdditiveRelicMultiplierAmount',
        'BonusModel$$GetBonus', 'PrestigeModel$$GetBonusRelicsFromStageCount',
        'GHDouble$$op_Implicit', 'GHDouble$$op_Addition', 'GHDouble$$op_Multiply',
        'GHDouble$$Ceiling')]
    expected_order = [
        'PrestigeModel$$GetCurrentAdditiveRelicMultiplierBonus',
        'PrestigeModel$$GetRewardableAdditiveRelicMultiplierAmount',
        'GHDouble$$op_Implicit', 'GHDouble$$op_Addition',       # 累加倍率那一項
        'BonusModel$$GetBonus', 'PrestigeModel$$GetBonusRelicsFromStageCount',
        'GHDouble$$op_Multiply',                                # 曲線 × PrestigeRelic
        'GHDouble$$op_Implicit', 'BonusModel$$GetBonus', 'GHDouble$$op_Addition',
        'GHDouble$$op_Multiply',                                # × (1 + PrestigeRelicAdditive)
        'GHDouble$$op_Multiply',                                # × 累加倍率
        'BonusModel$$GetBonus', 'GHDouble$$op_Multiply',        # × OnlyPrestigeRelic
        'GHDouble$$Ceiling']
    if interesting != expected_order:
        raise ValueError(f'the outer sequence changed:\n  got      {interesting}\n'
                         f'  expected {expected_order}')
    # The 1 in `1 + PrestigeRelicAdditive` is an immediate, and the additive term's own
    # coefficient is a named [ServerVar] rather than a constant.
    outer_text = '\n'.join(f'{i.mnemonic} {i.op_str}' for i in outer)
    if not re.search(r'mov w0, #1\b', outer_text):
        raise ValueError('the 1 in (1 + PrestigeRelicAdditive) is gone')
    if not re.search(r'ldr s\d+, \[x\d+, #0xc54\]', outer_text):
        raise ValueError('stageRushToRelicMultiplier is no longer read')

    match = re.search(r'public static \S+ '+OUTER_VAR[0]+r'; // 0x([0-9A-Fa-f]+)', variables)
    if not match or int(match.group(1), 16) != OUTER_VAR[1]:
        raise ValueError(f'{OUTER_VAR[0]} is no longer at {OUTER_VAR[1]:#x}')

    # 5. The additive-multiplier term, which is what the engine leaves out. Both halves are short.
    model = re.search(r'^public class PrestigeModel(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)
    owned = re.search(r'private int <'+OWNED_FIELD[0]+r'>k__BackingField; // 0x([0-9A-Fa-f]+)', model)
    if not owned or int(owned.group(1), 16) != OWNED_FIELD[1]:
        raise ValueError(f'PrestigeModel.{OWNED_FIELD[0]} is no longer at {OWNED_FIELD[1]:#x}')
    bonus_text = '\n'.join(f'{i.mnemonic} {i.op_str}' for i in instructions(CURRENT_ADDITIVE))
    for needed, why in ((r'ldr w\d+, \[x\d+, #0x48\]', 'the owned count'),
                        (r'ldr s\d+, \[x\d+, #0xc54\]', 'stageRushToRelicMultiplier'),
                        (r'fmov s\d+, #1\.00000000', 'the 1 it is added to'),
                        (r'fmul s\d+, s\d+, s\d+', 'the multiply'),
                        (r'fadd s\d+, s\d+, s\d+', 'the add')):
        if not re.search(needed, bonus_text):
            raise ValueError(f'GetCurrentAdditiveRelicMultiplierBonus no longer contains {why}')
    rewardable = instructions(REWARDABLE)
    rewardable_calls = [symbols.get(int(i.op_str.lstrip('#'), 16), '') for i in rewardable
                        if i.mnemonic in ('bl', 'b') and i.op_str.startswith('#')]
    if symbols[NEXT_ADDITIVE] not in rewardable_calls:
        raise ValueError('GetRewardableAdditiveRelicMultiplierAmount no longer asks for the next tier')
    tail_max = rewardable[-1]
    if not (tail_max.mnemonic == 'b' and int(tail_max.op_str.lstrip('#'), 16) == MATH_MAX):
        raise ValueError('GetRewardableAdditiveRelicMultiplierAmount no longer ends in Math.Max')
    rewardable_text = '\n'.join(f'{i.mnemonic} {i.op_str}' for i in rewardable)
    if not re.search(r'sub w1, w\d+, w\d+', rewardable_text) or 'mov w0, wzr' not in rewardable_text:
        raise ValueError('the Max(0, next - owned) shape is gone')

    defaults = json.loads((ROOT/'reference/tt2/8.2.0/servervar-defaults.json')
                          .read_text(encoding='utf-8'))['recovered']
    if OUTER_VAR[0] not in defaults:
        raise ValueError(f'{OUTER_VAR[0]} has no recovered default')
    outer_value = defaults[OUTER_VAR[0]]['value']
    values = {}
    for name in VARS:
        if name not in defaults:
            raise ValueError(f'{name} has no recovered default; run audit-servervar-defaults.py first')
        values[name] = defaults[name]['value']

    def native(stage):
        clamped = min(stage, values['relicsStageMax'])
        first = values['relicStageMult2']*(values['relicStageOffset']+clamped)
        second = values['relicStageMult1']*values['relicStageBase']**(clamped**values['relicStageExpo'])
        exponent = min(values['relicStageExpoMax3'],
                       values['relicStageExpo2']*(1+values['relicStageMult3']
                                                  * clamped**values['relicStageExpo3']))
        third = values['relicStageBase2']**(clamped**exponent)
        return max(0.0, first+second+third), first, second, third, exponent

    def engine(stage):
        # The engine rounds up, as the native does; max(1, ...) is its own floor underneath.
        return max(1, math.ceil(stage**ENGINE_EXPO/ENGINE_DIVISOR))

    comparison = {}
    for stage in SAMPLE_STAGES:
        total, first, second, third, exponent = native(stage)
        theirs = engine(stage)
        comparison[str(stage)] = {
            'engine': theirs, 'native': total, 'ratio': total/theirs,
            'terms': {'linear': first, 'powerOfBase': second, 'powerOfBase2': third},
            'thirdExponent': exponent,
            'exponentAtCeiling': exponent >= values['relicStageExpoMax3'],
        }
    ceiling_from = next(stage for stage in SAMPLE_STAGES
                        if comparison[str(stage)]['exponentAtCeiling'])

    document = {
        'version': '8.2.0',
        'role': '蛻變聖物曲線的完整原生算式：三段各自的形狀、十個係數的預設值，'
                '以及與引擎 7.5 近似的逐關對照。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': '之前只讀出三段中的兩段，第三段那個包在 Math.Pow 裡的 Math.Min 這次讀完了：'
                   '指數本身是 Min(relicStageExpoMax3, relicStageExpo2 × (1 + relicStageMult3 × '
                   '關卡^relicStageExpo3))，再拿它當 關卡 的指數，最後以 relicStageBase2 為底做 '
                   'GHDouble.Pow。三段相加後 GHDouble.Max 夾在 0 以上。'
                   f'十個係數全部有編譯期預設值（先前記為八個，relicStageExpo3 = '
                   f'{values["relicStageExpo3"]} 與 relicStageExpoMax3 = '
                   f'{values["relicStageExpoMax3"]} 也有），所以整條曲線可以直接算出來。',
        'consequence': f'原生與引擎在第 2000 關以內同數量級（1.6–3.4 倍），'
                       f'第 {ceiling_from} 關起第三段的指數頂到上限 {values["relicStageExpoMax3"]}，'
                       f'1.002^(關卡^{values["relicStageExpoMax3"]}) 開始主導，'
                       f'到關卡上限時差 10^95 量級。整條換掉等於重做蛻變經濟，'
                       f'且與怪物曲線那條配套，因此仍不採用，改為附上完整算式與對照。',
        'methods': {'bonusRelics': fact(BONUS_RELICS), 'totalRelics': fact(TOTAL_RELICS)},
        'formula': {
            'clamp': '關卡 = Min(關卡, relicsStageMax)',
            'term1': 'relicStageMult2 × (relicStageOffset + 關卡)',
            'term2': 'relicStageMult1 × relicStageBase ^ (關卡 ^ relicStageExpo)',
            'term3Exponent': 'Min(relicStageExpoMax3, relicStageExpo2 × '
                             '(1 + relicStageMult3 × 關卡 ^ relicStageExpo3))',
            'term3': 'relicStageBase2 ^ (關卡 ^ 上面那個指數)',
            'combine': 'Max(0, term1 + term2 + term3)',
            'note': '三次 System.Math.Pow 加一次 GHDouble.Pow：前兩次算 term2 的內外層指數，'
                    '第三次算 term3 的 關卡^指數，GHDouble.Pow 才是 relicStageBase2 那一層——'
                    '因為它的結果會超出 double 而必須用 GHDouble 表示。',
        },
        'coefficients': {name: {'offset': hex(VARS[name]), 'value': values[name]} for name in VARS},
        'readOrder': coefficients,
        'outer': {
            'method': symbols[TOTAL_RELICS],
            'multipliers': multipliers,
            'rounding': 'GHDouble.Ceiling',
            'callOrder': interesting,
            'formula': 'Ceiling(曲線值 × Bonus(PrestigeRelic) × (1 + Bonus(PrestigeRelicAdditive)) '
                       '× 累加倍率 × Bonus(OnlyPrestigeRelic))',
            'additiveTerm': {
                'formula': 'GetCurrentAdditiveRelicMultiplierBonus() + stageRushToRelicMultiplier '
                           '× GetRewardableAdditiveRelicMultiplierAmount()',
                'coefficient': {'name': OUTER_VAR[0], 'offset': hex(OUTER_VAR[1]),
                                'value': outer_value},
                'expanded': '兩半都很短：前者是 1 + stageRushToRelicMultiplier × '
                            'PrestigeModel.AdditiveRelicMultiplier（已擁有的數量），'
                            '後者是 Math.Max(0, GetNextAdditiveRelicMultiplier() − 已擁有)，'
                            '所以整項化簡成 1 + stageRushToRelicMultiplier × Max(已擁有, 下一個門檻)。',
                'inertWhenAbsent': True,
                'note': '**沒有累加倍率時這一項就是 1**（已擁有 0、下一個門檻 0），'
                        '所以引擎省略它與原生等價，不是「未照做」。'
                        '將來實作累加倍率系統時要把它加回來——它依賴 '
                        'PlayerModel.GetSeasonalMaxStageReached，本專案也沒有季節系統。',
                'methods': {'currentBonus': fact(CURRENT_ADDITIVE), 'rewardable': fact(REWARDABLE)},
            },
            'note': '跟著 GHDouble 運算子的 out 指標在堆疊上的去向讀，四個乘數的結合順序就定下來了：'
                    '曲線值先乘 Bonus(PrestigeRelic)，再乘 (1 + Bonus(PrestigeRelicAdditive))'
                    '（那個 1 是 mov w0,#1 的立即數），接著乘累加倍率那一項，'
                    '最後乘 Bonus(OnlyPrestigeRelic)，再無條件進位。',
        },
        'adopted': {
            'what': '(1 + Bonus(PrestigeRelicAdditive)) 與 × Bonus(OnlyPrestigeRelic) 兩個乘數',
            'why': '順序已逐指令確定，兩者在乾淨存檔都是無作用值'
                   '（前者是加法型、預設 0，後者是乘法型、預設 1），結構與原生相同，影響溫和。',
            'notAdopted': '曲線本體維持 7.5 近似，理由見 differsFromEngine。'
                          '累加倍率那一項不必接——展開後在沒有該系統時恆為 1。',
        },
        'engineFormula': f'max(1, ceil(關卡^{ENGINE_EXPO} ÷ {ENGINE_DIVISOR} × Bonus(PrestigeRelic) '
                         f'× (1 + Bonus(PrestigeRelicAdditive)) × Bonus(OnlyPrestigeRelic)))',
        'comparison': comparison,
        'limits': [
            '十個係數都是 [ServerVar]，本表用的是編譯期預設值，不是線上值',
            'GetNextAdditiveRelicMultiplier 未展開，只確定它是 Max(0, 它 − 已擁有) 的被減數；'
            '累加倍率的取得條件（GetRequiredStageForAdditiveRelicMultiplier 等）整組未查',
            '對照表以 double 計算；原生前兩段走 double、第三段走 GHDouble，極大關卡的尾數會有差異',
            '季節聖物（GetTotalSeasonalRelicsFromStageCount）是另一條路徑，未查',
        ],
    }
    target = ROOT/'reference/tt2/8.2.0/relic-curve-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    sample = comparison['1000']
    print(f'Recovered all three relic terms; ten coefficients have defaults. '
          f'Stage 1000: engine {sample["engine"]}, native {sample["native"]:.0f} '
          f'({sample["ratio"]:.2f}x). The third exponent reaches its ceiling '
          f'{values["relicStageExpoMax3"]} by stage {ceiling_from}, after which they diverge without limit.')


if __name__ == '__main__':
    main()
