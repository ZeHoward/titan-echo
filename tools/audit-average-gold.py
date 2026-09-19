"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

The pet's Hand of Midas was blocked on MonsterModel.GetAverageBossGoldDrop, which is a boss drop
times three expected values. Those three turn out to be two tiny methods:

    BonusModel.GetAverage10xGold(type) = 1 + 9 * Bonus(type)      -- only three types allowed
    BonusModel.GetAverageJackpotGold() = 1 + Bonus(JackpotGoldChance)
                                           * (Bonus(JackpotGold) ^ jackpotGoldBonusExpo - 1)

Both are the textbook expected value of "roll a chance, multiply on a hit". The x10 one is an
*approximation* of its own game: the actual drop path (StageLogic.CalculateMonsterGoldDrop) asks
MonsterModel.Try10xGold how many times it hit and multiplies by 10^hits, so two hits are possible,
while the average above only ever counts one. That is native behaviour, recorded here rather than
corrected.

Recording the roll path matters for a second reason: it is where JackpotGold actually belongs.
GetMonsterGoldDrop never asks for it -- the roll does, once, behind RollGoldBonus. So a project
that multiplies every gold source by JackpotGold unconditionally is running that bonus at a 100%
chance, and the fix is two different shapes for two different callers, not one.
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

AVERAGE_10X = 0x2718224      # BonusModel.GetAverage10xGold(BonusType)
AVERAGE_JACKPOT = 0x2718388  # BonusModel.GetAverageJackpotGold()
CALCULATE_DROP = 0x25439C4   # StageLogic.CalculateMonsterGoldDrop(...)
TRY_10X = 0x2327F04          # MonsterModel.Try10xGold(...)
ROLL_BONUS = 0x2328020       # MonsterModel.RollGoldBonus(BonusType, ...)
BOSS_GOLD = 0x232742C        # MonsterModel.GetAverageBossGoldDrop(int, bool)
FAIRY_GOLD = 0x21C11E8       # FairyController.GetFairyGoldAmount(...)
GET_BONUS = 0x2714C88        # BonusModel.GetBonus(BonusType, ...)
EXPLICIT = 0x21E0F08         # GHDouble.op_Explicit(GHDouble) -> float
POW = 0x21DED24              # GHDouble.Pow(GHDouble, double)
MULTIPLY = 0x21DD6EC         # GHDouble.op_Multiply
SUBTRACT = 0x21DE988         # GHDouble.op_Subtraction
ADD = 0x21DE5CC              # GHDouble.op_Addition
MATH_POW = 0x3FCC8E0         # System.Math.Pow(double, double)
LOG_ERROR = 0x3CC0BB4        # GHDebug.LogError
NAMES = {AVERAGE_10X: 'BonusModel$$GetAverage10xGold',
         AVERAGE_JACKPOT: 'BonusModel$$GetAverageJackpotGold',
         CALCULATE_DROP: 'StageLogic$$CalculateMonsterGoldDrop',
         TRY_10X: 'MonsterModel$$Try10xGold',
         ROLL_BONUS: 'MonsterModel$$RollGoldBonus',
         BOSS_GOLD: 'MonsterModel$$GetAverageBossGoldDrop',
         FAIRY_GOLD: 'FairyController$$GetFairyGoldAmount',
         GET_BONUS: 'BonusModel$$GetBonus',
         EXPLICIT: 'GHDouble$$op_Explicit', POW: 'GHDouble$$Pow',
         MULTIPLY: 'GHDouble$$op_Multiply', SUBTRACT: 'GHDouble$$op_Subtraction',
         ADD: 'GHDouble$$op_Addition', MATH_POW: 'System.Math$$Pow',
         LOG_ERROR: 'GHDebug$$LogError'}
JACKPOT_EXPO_OFFSET = 0xBC0  # ServerVarsModel.jackpotGoldBonusExpo


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

    def body(address, cap=0x4000):
        following = next((a for a in starts if a > address), address+0x400)
        return read(address, min(following-address, cap))

    def instructions(address, cap=0x4000):
        return list(machine.disasm(body(address, cap), address))

    def listing_text(listing):
        return '\n'.join(f'{i.mnemonic} {i.op_str}' for i in listing)

    def fact(address):
        return {'name': symbols[address], 'rva': hex(address), 'bytesSha256': sha(body(address))}

    def target(instruction):
        if instruction.mnemonic not in ('bl', 'b') or not instruction.op_str.startswith('#'):
            return None
        return int(instruction.op_str.lstrip('#'), 16)

    def calls(listing):
        return [name for name in (symbols.get(target(i), '') for i in listing) if name]

    def literal(listing, index, register):
        """The immediate `register` holds at `index`, or None when it was not set from one.

        Walking back for the last `mov reg, #imm` is not enough: a later `ldr reg, [x0, #0x38]`
        loads the type out of a field, and the stale mov from an earlier branch would be read as
        that call's argument. So the first instruction that writes the register decides -- an
        immediate move answers, anything else means "not a constant here".
        """
        pattern = re.compile(register+r', #(0x[0-9a-f]+|\d+)$')
        for earlier in reversed(listing[:index]):
            if not earlier.op_str.startswith(register+','):
                continue
            match = pattern.fullmatch(earlier.op_str) if earlier.mnemonic == 'mov' else None
            return int(match.group(1), 0) if match else None
        return None

    def asked(listing, callee):
        """Which BonusType each call to `callee` asks for, in order; None when not a constant."""
        return [literal(listing, index, 'w1') for index, i in enumerate(listing)
                if target(i) == callee]

    for address, name in NAMES.items():
        if symbols.get(address) != name:
            raise ValueError(f'method identity mismatch at {address:#x}: {symbols.get(address)!r}')

    types = re.search(r'public enum BonusType(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)
    bonus_names = {int(value): name for name, value
                   in re.findall(r'public const BonusType (\w+) = (\d+);', types)}
    variables = re.search(r'^public class ServerVarsModel(?=[\s:])[^\n]*\n\{(.*?)^\}',
                          dump, re.S | re.M).group(1)
    match = re.search(r'public static \S+ jackpotGoldBonusExpo; // 0x([0-9A-Fa-f]+)', variables)
    if not match or int(match.group(1), 16) != JACKPOT_EXPO_OFFSET:
        raise ValueError(f'jackpotGoldBonusExpo is no longer at {JACKPOT_EXPO_OFFSET:#x}')

    # 1. The x10 average: an allow-list of three bonuses, then 1 + 9 x chance.
    tenx = instructions(AVERAGE_10X)
    tenx_text = listing_text(tenx)
    allowed = sorted(int(m, 0) for m in re.findall(r'cmp w19, #(0x[0-9a-f]+|\d+)\n', tenx_text+'\n'))
    allowed_names = sorted(bonus_names.get(value) for value in allowed)
    if allowed_names != ['BossGoldx10Chance', 'ChestGoldx10Chance', 'Goldx10Chance']:
        raise ValueError(f'GetAverage10xGold now allows {allowed_names}')
    tenx_calls = calls(tenx)
    for name in (symbols[GET_BONUS], symbols[EXPLICIT], symbols[LOG_ERROR]):
        if name not in tenx_calls:
            raise ValueError(f'GetAverage10xGold no longer calls {name}')
    if not re.search(r'fmov s\d+, #9\.0+\nfmul s0, s0, s\d+\nfmov s\d+, #1\.0+\nfadd s0, s0, s\d+',
                     tenx_text):
        raise ValueError('GetAverage10xGold is no longer 1 + 9 x chance')
    # The rejected path logs and hands back a neutral 1, it does not throw.
    rejected = next(index for index, i in enumerate(tenx) if target(i) == LOG_ERROR)
    if not re.fullmatch(r's0, #1\.0+', tenx[rejected+1].op_str) or tenx[rejected+1].mnemonic != 'fmov':
        raise ValueError('the rejected path of GetAverage10xGold no longer returns 1')

    # 2. The jackpot average: 1 + chance x (amount ^ expo - 1), in that order.
    jackpot = instructions(AVERAGE_JACKPOT)
    wanted = [bonus_names.get(value) for value in asked(jackpot, GET_BONUS)]
    if wanted != ['JackpotGold', 'JackpotGoldChance']:
        raise ValueError(f'GetAverageJackpotGold now reads {wanted}')
    shape = [name for name in calls(jackpot)
             if name in (symbols[POW], symbols[MULTIPLY], symbols[SUBTRACT], symbols[ADD])]
    if shape != [symbols[POW], symbols[MULTIPLY], symbols[SUBTRACT], symbols[ADD]]:
        raise ValueError(f'GetAverageJackpotGold is no longer pow-mul-sub-add: {shape}')
    if not re.search(r'ldr s\d+, \[x\d+, #'+f'{JACKPOT_EXPO_OFFSET:#x}'+r'\]', listing_text(jackpot)):
        raise ValueError('GetAverageJackpotGold no longer reads jackpotGoldBonusExpo')

    # 3. The roll path, which is a different shape from the average -- and the only place the
    # live game asks for JackpotGold outside the average.
    drop = instructions(CALCULATE_DROP)
    drop_calls = calls(drop)
    for name in (symbols[TRY_10X], symbols[ROLL_BONUS], symbols[MATH_POW]):
        if name not in drop_calls:
            raise ValueError(f'CalculateMonsterGoldDrop no longer calls {name}')
    if drop_calls.index(symbols[TRY_10X]) > drop_calls.index(symbols[ROLL_BONUS]):
        raise ValueError('CalculateMonsterGoldDrop no longer rolls x10 before the jackpot')
    rolled = [bonus_names.get(value) for value in asked(drop, ROLL_BONUS)]
    if rolled != ['JackpotGoldChance']:
        raise ValueError(f'CalculateMonsterGoldDrop now rolls {rolled}')
    # Two GetBonus calls, but only one names a constant: the other reads its type out of a field.
    constants = [bonus_names.get(value) for value in asked(drop, GET_BONUS) if value is not None]
    if constants != ['JackpotGold']:
        raise ValueError(f'CalculateMonsterGoldDrop now asks for {constants}, expected JackpotGold')
    # 10 ^ hits, so two hits in one drop are possible and the average above under-counts them.
    power = next(index for index, i in enumerate(drop) if target(i) == MATH_POW)
    if not any(i.mnemonic == 'fmov' and re.fullmatch(r'd0, #10\.0+', i.op_str)
               for i in drop[max(0, power-6):power]):
        raise ValueError('the x10 roll no longer multiplies by 10 ^ hits')

    # 4. Who consumes the averages, and which pair each one asks for.
    consumers = {}
    for address in (BOSS_GOLD, FAIRY_GOLD):
        listing = instructions(address)
        pair = [bonus_names.get(value) for value in asked(listing, AVERAGE_10X)]
        if len(pair) != 2:
            raise ValueError(f'{symbols[address]} no longer averages exactly two x10 bonuses')
        if pair[0] != 'Goldx10Chance':
            raise ValueError(f'{symbols[address]} no longer starts from Goldx10Chance')
        if symbols[AVERAGE_JACKPOT] not in calls(listing):
            raise ValueError(f'{symbols[address]} no longer multiplies by the jackpot average')
        consumers[symbols[address]] = {'rva': hex(address), 'x10Bonuses': pair,
                                       'jackpot': True}

    defaults = json.loads((ROOT/'reference/tt2/8.2.0/bonus-defaults-evidence.json')
                          .read_text(encoding='utf-8'))['defaults']
    if 'Goldx10Chance' not in defaults:
        raise ValueError('Goldx10Chance lost its compiled-in base; run audit-bonus-defaults.py')
    servervars = json.loads((ROOT/'reference/tt2/8.2.0/servervar-defaults.json')
                            .read_text(encoding='utf-8'))['recovered']
    expo = servervars['jackpotGoldBonusExpo']['value']
    base = defaults['Goldx10Chance']['value']

    document = {
        'version': '8.2.0',
        'role': '兩個期望值方法的形狀，以及它們與實際擲骰那條路的差別。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': f'兩個方法都是課本上的期望值。`GetAverage10xGold(型)` ＝ '
                   f'`1 + 9 × Bonus(型)`，而且**只認三個加成**'
                   f'（Goldx10Chance、BossGoldx10Chance、ChestGoldx10Chance），'
                   f'其他型別會 LogError 並回中性值 1。'
                   f'`GetAverageJackpotGold()` ＝ '
                   f'`1 + Bonus(JackpotGoldChance) × (Bonus(JackpotGold)^jackpotGoldBonusExpo − 1)`，'
                   f'指數的預設值是 {expo}。'
                   f'**十倍金幣那個期望值是原生自己取的近似**：實際掉落走 '
                   f'`StageLogic.CalculateMonsterGoldDrop`，先問 `MonsterModel.Try10xGold` '
                   f'中了幾次再乘 `10^次數`，所以一次掉落可以中兩次；'
                   f'`1 + 9p` 只算得到中一次。照原生保留，不自行修正。',
        'consequence': f'`Goldx10Chance` 有編譯期基礎值 {base:.2f}（加法型，中性值 0，一定要加），'
                       f'所以接上期望值之後**每個人的妖精與寵物金幣都會乘 1.09**。'
                       f'另外兩個 x10 加成本專案沒有來源，期望值是 1。'
                       f'**JackpotGold 的位置要改**：`GetMonsterGoldDrop` 從頭到尾沒有問過它，'
                       f'整個映像只有兩處讀它——期望值這裡，以及擲骰那條路 '
                       f'（`RollGoldBonus(JackpotGoldChance)` 中了才乘）。'
                       f'所以把 JackpotGold 無條件套在每一種金幣上，等於把機率當成 100%。',
        'methods': {'average10x': fact(AVERAGE_10X), 'averageJackpot': fact(AVERAGE_JACKPOT),
                    'rollPath': fact(CALCULATE_DROP)},
        'formulas': {
            'average10x': '1 + 9 × Bonus(型)，只認三型，其餘 LogError 回 1',
            'averageJackpot': '1 + Bonus(JackpotGoldChance) × '
                              '(Bonus(JackpotGold)^jackpotGoldBonusExpo − 1)',
            'rollPath': 'Try10xGold() 回中了幾次 → × 10^次數；'
                        'RollGoldBonus(JackpotGoldChance) 中了 → × Bonus(JackpotGold)',
        },
        'allowedX10Bonuses': allowed_names,
        'consumers': consumers,
        'coefficients': {
            'jackpotGoldBonusExpo': {'offset': hex(JACKPOT_EXPO_OFFSET), 'value': expo},
            'Goldx10Chance': {'field': defaults['Goldx10Chance']['field'],
                              'offset': defaults['Goldx10Chance']['offset'], 'value': base},
        },
        'jackpotReaders': ['BonusModel$$GetAverageJackpotGold',
                           'StageLogic$$CalculateMonsterGoldDrop'],
        'limits': '只讀了兩個期望值方法的完整形狀、擲骰那條路的兩個呼叫與它們問的加成，'
                  '以及兩個消費端各問哪一對 x10。沒有走進 Try10xGold 與 RollGoldBonus 內部，'
                  '所以「一次掉落最多能中幾次十倍」與擲骰用的亂數來源都還沒解。'
                  'jackpotGoldBonusExpo 與 Goldx10Chance 的基礎值都是編譯期預設值，線上可覆蓋。',
    }
    out = ROOT/'reference/tt2/8.2.0/average-gold-evidence.json'
    out.write_bytes((json.dumps(document, ensure_ascii=False, indent=1)+'\n').encode('utf-8'))
    print(f'wrote {out.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
