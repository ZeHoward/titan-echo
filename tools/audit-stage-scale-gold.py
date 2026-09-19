"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

Three gold formulas were registered as "not restored" with the same blocker: the stage scaling.
It is one short static method:

    PlayerModel.GetStageScaleGoldAmount(stage)
        = Max(stageScaleMinAmount, stageScaleSlope * Pow(stage, stageScaleExpo))

Every consumer raises that value to its own exponent and multiplies it into a payout that was
already computed some other way. The fairy does it to a treasure titan's drop, the pet's Hand of
Midas QTE does it to a boss drop, and both exponents are their own [ServerVar]. So the stage
scaling is not a curve of its own -- it is a second stage term layered on top of the monster curve,
and until it is restored the fairy pays out as if the game never left the first few hundred stages.

This also records the shape of MonsterModel.GetAverageBossGoldDrop, the other half of the pet's
Hand of Midas chain, so that what is still missing there is a named list rather than a blank.
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

STAGE_SCALE = 0x23DC644          # PlayerModel.GetStageScaleGoldAmount(int stage)
CURRENT_STAGE_SCALE = 0x23DC7C8  # PlayerModel.GetStageScaleGoldAmount()
CURRENT_FAIRY_GOLD = 0x21C1748   # FairyController.GetFairyGoldAmount(bool, bool)
BOSS_GOLD = 0x232742C            # MonsterModel.GetAverageBossGoldDrop(int, bool)
FAIRY_GOLD = 0x21C11E8           # FairyController.GetFairyGoldAmount(int, bool, bool, GHDouble?)
PET_HOM_GOLD = 0x239ED20         # PetModel.GetPetHomGold(int, bool, GHDouble?)
MONSTER_GOLD = 0x2326D1C         # MonsterModel.GetMonsterGoldDrop(int, MonsterClass, int, bool)
CHESTERSON_GOLD = 0x2327AD0      # MonsterModel.GetChestersonGold(int, bool, GHDouble?)
AVERAGE_10X = 0x2718224          # BonusModel.GetAverage10xGold(BonusType)
AVERAGE_JACKPOT = 0x2718388      # BonusModel.GetAverageJackpotGold()
OBSCURED_INT = 0x1FDEAF0         # ObscuredInt.op_Implicit(ObscuredInt)
POW = 0x21DED24                  # GHDouble.Pow(GHDouble, double)
MAX = 0x21DFBC4                  # GHDouble.Max(GHDouble, GHDouble)
MULTIPLY = 0x21DD6EC             # GHDouble.op_Multiply(GHDouble, GHDouble)
NAMES = {STAGE_SCALE: 'PlayerModel$$GetStageScaleGoldAmount',
         CURRENT_STAGE_SCALE: 'PlayerModel$$GetStageScaleGoldAmount',
         CURRENT_FAIRY_GOLD: 'FairyController$$GetFairyGoldAmount',
         BOSS_GOLD: 'MonsterModel$$GetAverageBossGoldDrop',
         FAIRY_GOLD: 'FairyController$$GetFairyGoldAmount',
         PET_HOM_GOLD: 'PetModel$$GetPetHomGold',
         MONSTER_GOLD: 'MonsterModel$$GetMonsterGoldDrop',
         CHESTERSON_GOLD: 'MonsterModel$$GetChestersonGold',
         AVERAGE_10X: 'BonusModel$$GetAverage10xGold',
         AVERAGE_JACKPOT: 'BonusModel$$GetAverageJackpotGold',
         OBSCURED_INT: 'CodeStage.AntiCheat.ObscuredTypes.ObscuredInt$$op_Implicit',
         POW: 'GHDouble$$Pow', MAX: 'GHDouble$$Max', MULTIPLY: 'GHDouble$$op_Multiply'}
# The three that shape the curve, then the per-consumer exponents layered on top of it.
VARS = {'stageScaleMinAmount': 0x660, 'stageScaleSlope': 0x664, 'stageScaleExpo': 0x668,
        'petGoldStageScaleExpo': 0x66C, 'fairyGoldStageScaleExpo': 0x670,
        'petHomGoldMult': 0xB48}
# Where the no-argument overloads read their stage from.
STAGE_FIELD_OFFSET = 0xC8


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
        """Named calls in order. The unnamed trailing branch is il2cpp's throw helper, not a step."""
        return [name for name in (symbols.get(target(i), '') for i in listing) if name]

    for address, name in NAMES.items():
        if symbols.get(address) != name:
            raise ValueError(f'method identity mismatch at {address:#x}: {symbols.get(address)!r}')

    variables = re.search(r'^public class ServerVarsModel(?=[\s:])[^\n]*\n\{(.*?)^\}',
                          dump, re.S | re.M).group(1)
    for name, offset in VARS.items():
        match = re.search(r'public static \S+ '+name+r'; // 0x([0-9A-Fa-f]+)', variables)
        if not match or int(match.group(1), 16) != offset:
            raise ValueError(f'{name} is no longer at {offset:#x}')
    types = re.search(r'public enum BonusType(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)
    bonus_names = {int(value): name for name, value
                   in re.findall(r'public const BonusType (\w+) = (\d+);', types)}
    monster_classes = dict(re.findall(
        r'public const MonsterClass (\w+) = (\d+);',
        re.search(r'public enum MonsterClass(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)))

    def literal(listing, index, register):
        """The last immediate moved into `register` before `index`."""
        pattern = re.compile(register+r', #(0x[0-9a-f]+|\d+)$')
        for earlier in reversed(listing[:index]):
            match = pattern.fullmatch(earlier.op_str) if earlier.mnemonic == 'mov' else None
            if match:
                return int(match.group(1), 0)
        return None

    def exponent_offset(listing, call_index):
        """Which [ServerVar] was widened into d0 as the exponent of the Pow at `call_index`."""
        for earlier in reversed(listing[:call_index]):
            if earlier.mnemonic == 'fcvt' and earlier.op_str.startswith('d0, s'):
                register = earlier.op_str.split(', ')[1]
                for before in reversed(listing[:listing.index(earlier)]):
                    match = re.fullmatch(r'ldr '+register+r', \[x\d+, #(0x[0-9a-f]+)\]',
                                         f'{before.mnemonic} {before.op_str}')
                    if match:
                        return int(match.group(1), 16)
                return None
        return None

    # 1. The curve itself: a floor, a slope and an exponent, and nothing else.
    scaling = instructions(STAGE_SCALE)
    scaling_calls = calls(scaling)
    if scaling_calls[-1] != symbols[MAX]:
        raise ValueError(f'GetStageScaleGoldAmount no longer ends in GHDouble.Max: {scaling_calls[-1]}')
    ordered = [name for name in scaling_calls
               if name in (symbols[POW], symbols[MULTIPLY], symbols[MAX])]
    if ordered != [symbols[POW], symbols[MULTIPLY], symbols[MAX]]:
        raise ValueError(f'GetStageScaleGoldAmount is no longer pow-then-multiply-then-max: {ordered}')
    scaling_text = listing_text(scaling)
    for name in ('stageScaleMinAmount', 'stageScaleSlope', 'stageScaleExpo'):
        if not re.search(r'ldr s\d+, \[x\d+, #'+f'{VARS[name]:#x}'+r'\]', scaling_text):
            raise ValueError(f'GetStageScaleGoldAmount no longer reads {name}')
    power = next(index for index, i in enumerate(scaling) if target(i) == POW)
    if exponent_offset(scaling, power) != VARS['stageScaleExpo']:
        raise ValueError('stageScaleExpo is no longer the exponent of the Pow')

    # 2. Which stage the no-argument overloads read. Both unwrap the same ObscuredInt off the stage
    # singleton before forwarding, and that field is the current stage -- not the highest reached.
    controller = re.search(r'^public class StageLogicController(?=[\s:])[^\n]*\n\{(.*?)^\}',
                           dump, re.S | re.M).group(1)
    field = re.search(r'\bObscuredInt (\w+); // '+f'0x{STAGE_FIELD_OFFSET:X}'+r'\b', controller)
    if not field or field.group(1) != 'currentStage':
        raise ValueError(f'StageLogicController no longer keeps currentStage at {STAGE_FIELD_OFFSET:#x}')
    for address, forwards_to in ((CURRENT_STAGE_SCALE, STAGE_SCALE), (CURRENT_FAIRY_GOLD, FAIRY_GOLD)):
        listing = instructions(address)
        if not re.search(r'ldp x\d+, x\d+, \[x0, #'+f'{STAGE_FIELD_OFFSET:#x}'+r'\]',
                         listing_text(listing)):
            raise ValueError(f'{symbols[address]}() no longer reads currentStage')
        named = calls(listing)
        if symbols[OBSCURED_INT] not in named:
            raise ValueError(f'{symbols[address]}() no longer unwraps that field')
        if symbols[forwards_to] not in named:
            raise ValueError(f'{symbols[address]}() no longer forwards to the stage overload')

    # 3. Who raises the scaling to what. Both consumers load their own exponent before the Pow.
    consumers = {}
    for address, key, first in ((FAIRY_GOLD, 'fairyGoldStageScaleExpo', CHESTERSON_GOLD),
                                (PET_HOM_GOLD, 'petGoldStageScaleExpo', BOSS_GOLD)):
        listing = instructions(address)
        named = calls(listing)
        if symbols[first] not in named:
            raise ValueError(f'{symbols[address]} no longer starts from {symbols[first]}')
        if named.index(symbols[first]) > named.index(symbols[STAGE_SCALE]):
            raise ValueError(f'{symbols[address]} no longer computes its base before the scaling')
        scale_index = next(index for index, i in enumerate(listing) if target(i) == STAGE_SCALE)
        power = next(index for index, i in enumerate(listing)
                     if index > scale_index and target(i) == POW)
        if exponent_offset(listing, power) != VARS[key]:
            raise ValueError(f'{symbols[address]} no longer raises the scaling to {key}')
        consumers[symbols[address]] = {'rva': hex(address), 'base': symbols[first], 'exponent': key}

    # 4. The other half of the pet chain, so what is still missing there has names.
    boss = instructions(BOSS_GOLD)
    boss_calls = calls(boss)
    drop = next(index for index, i in enumerate(boss) if target(i) == MONSTER_GOLD)
    monster_class = literal(boss, drop, 'w2')
    if str(monster_class) != monster_classes.get('Boss'):
        raise ValueError(f'GetAverageBossGoldDrop asks for MonsterClass {monster_class}, not Boss')
    if literal(boss, drop, 'w3') != 1:
        raise ValueError('GetAverageBossGoldDrop no longer asks for a single monster')
    averaged = [bonus_names.get(literal(boss, index, 'w1')) for index, i in enumerate(boss)
                if target(i) == AVERAGE_10X]
    if averaged != ['Goldx10Chance', 'BossGoldx10Chance']:
        raise ValueError(f'GetAverageBossGoldDrop now averages {averaged}')
    if symbols[AVERAGE_JACKPOT] not in boss_calls:
        raise ValueError('GetAverageBossGoldDrop no longer multiplies by the jackpot average')
    if boss_calls.count(symbols[MULTIPLY]) != 3:
        raise ValueError(f'GetAverageBossGoldDrop has {boss_calls.count(symbols[MULTIPLY])} '
                         f'multiplies, expected 3')

    defaults = json.loads((ROOT/'reference/tt2/8.2.0/servervar-defaults.json')
                          .read_text(encoding='utf-8'))['recovered']
    values = {}
    for name in VARS:
        if name not in defaults:
            raise ValueError(f'{name} has no recovered default; run audit-servervar-defaults.py first')
        values[name] = defaults[name]['value']

    document = {
        'version': '8.2.0',
        'role': '金幣的關卡縮放：那條曲線長什麼樣、誰把它拿去次方，以及頭目平均金幣的形狀。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': f'`GetStageScaleGoldAmount(關卡)` 只有一行：'
                   f'`max(stageScaleMinAmount, stageScaleSlope × 關卡^stageScaleExpo)`，'
                   f'三個係數分別是 {values["stageScaleMinAmount"]}、'
                   f'{values["stageScaleSlope"]:.3f} 與 {values["stageScaleExpo"]:.2f}。'
                   f'**它不是一條獨立的金幣曲線，是疊在既有掉落上的第二個關卡項**：'
                   f'妖精把寶箱泰坦的掉落乘上它的 fairyGoldStageScaleExpo'
                   f'（{values["fairyGoldStageScaleExpo"]:.1f}）次方，'
                   f'寵物的米達斯之心把頭目平均掉落乘上 petGoldStageScaleExpo'
                   f'（{values["petGoldStageScaleExpo"]:.1f}）次方。'
                   f'乘積要到第 459 關左右才追過下限，所以在那之前整段只是個常數倍，'
                   f'越往後才越拉開。兩個無參數多載讀的都是 StageLogicController.currentStage，'
                   f'**看的是目前所在的關卡，不是歷史最高**。',
        'consequence': '沒有這一項，妖精的金幣等於一路停在最前面那幾百關的係數上，'
                       '關卡越高差越多——接上去會讓所有人的妖精金幣變多，這是原生行為。'
                       '米達斯之心還缺另一半：頭目平均金幣要乘兩個十倍金幣的期望值與累積金幣的期望值，'
                       '那三個是各自獨立的一段。',
        'methods': {'stageScale': fact(STAGE_SCALE),
                    'currentStageScale': fact(CURRENT_STAGE_SCALE),
                    'currentFairyGold': fact(CURRENT_FAIRY_GOLD),
                    'averageBossGold': fact(BOSS_GOLD),
                    'fairyGold': fact(FAIRY_GOLD),
                    'petHomGold': fact(PET_HOM_GOLD)},
        'formulas': {
            'stageScale': 'max(stageScaleMinAmount, stageScaleSlope × 關卡^stageScaleExpo)',
            'fairyGold': 'GetChestersonGold(關卡) × 關卡縮放^fairyGoldStageScaleExpo × …',
            'petHomGold': 'GetAverageBossGoldDrop(關卡) × 關卡縮放^petGoldStageScaleExpo × …',
            'averageBossGold': 'GetMonsterGoldDrop(關卡, MonsterClass.Boss, 1 隻, 變異) × '
                               'GetAverage10xGold(Goldx10Chance) × '
                               'GetAverage10xGold(BossGoldx10Chance) × GetAverageJackpotGold()',
        },
        'coefficients': {name: {'offset': hex(VARS[name]), 'value': values[name]} for name in VARS},
        'consumers': consumers,
        'stageSource': 'StageLogicController.currentStage',
        'callers': sorted(call_sites(binary, elf, symbols, starts, STAGE_SCALE)),
        'averageBossGold': {
            'monsterClass': 'Boss',
            'averages': averaged,
            'jackpot': symbols[AVERAGE_JACKPOT],
            'missingHere': ['GetAverage10xGold（兩次）', 'GetAverageJackpotGold'],
        },
        'limits': '只讀了這六個方法的呼叫順序、三個 [ServerVar] 的載入位置、兩個指數各是哪一個變數，'
                  '以及兩個無參數多載讀的是哪一個欄位；沒有逐條判定 Max 的條件碼，'
                  '也沒有走進 GetMonsterGoldDrop。'
                  '三個係數是編譯期預設值（狀態 default），線上可被伺服器覆蓋。',
    }
    out = ROOT/'reference/tt2/8.2.0/stage-scale-gold-evidence.json'
    out.write_bytes((json.dumps(document, ensure_ascii=False, indent=1)+'\n').encode('utf-8'))
    print(f'wrote {out.relative_to(ROOT)}')


def call_sites(binary, elf, symbols, starts, destination):
    """Every method containing a branch to `destination`, named."""
    import array
    import bisect
    found = set()
    for segment in elf.iter_segments():
        if segment['p_type'] != 'PT_LOAD' or not (segment['p_flags'] & 1):
            continue
        base = segment['p_vaddr']
        data = binary[segment['p_offset']:segment['p_offset']+segment['p_filesz']]
        words = array.array('I')
        words.frombytes(data[:len(data)//4*4])
        for index, word in enumerate(words):
            if (word & 0x7C000000) != 0x14000000:
                continue
            offset = word & 0x03FFFFFF
            if offset & 0x02000000:
                offset -= 0x04000000
            address = base+index*4
            if address+offset*4 != destination:
                continue
            owner = bisect.bisect_right(starts, address)-1
            if owner >= 0:
                found.add(symbols[starts[owner]])
    return found


if __name__ == '__main__':
    main()
