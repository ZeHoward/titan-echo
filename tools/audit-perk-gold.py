"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

Make It Rain's immediate gold was registered as "not restored" with no detail. Its shape is short
and readable:

    GetMakeItRainGold() picks a stage from the player's current and highest-reached stage,
        weighting the gap between them by makeItRainMaxStageMult, then calls
    GetPerkGold(stage) = (GetLargestGoldSourceAmount(stage) * Bonus(PerkGold)) ^ perkGoldReduction

So the payout is not a formula over the stage at all: it is whatever the player's best single gold
source is worth at that stage, raised to a power just under 1. That makes it unreachable for this
project without first restoring GetLargestGoldSourceAmount, which is 387 instructions and picks a
maximum over four gold sources plus Hand of Midas and a QTE check. This records the shape, the
coefficients and the dependency chain, so that "not restored" is a decision with evidence rather
than a blank.
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

RAIN_GOLD = 0x23823BC        # PerkModel.GetMakeItRainGold()
PERK_GOLD = 0x238737C        # PerkModel.GetPerkGold(int stage)
LARGEST_SOURCE = 0x23DCADC   # PlayerModel.GetLargestGoldSourceAmount(int, bool)
MAX_STAGE = 0x23E0B0C        # PlayerModel.GetMaxServerStageReached()
GET_BONUS = 0x2714C88        # BonusModel.GetBonus(BonusType, ...)
GHDOUBLE_POW = 0x21DED24     # GHDouble.Pow(GHDouble, double)
NAMES = {RAIN_GOLD: 'PerkModel$$GetMakeItRainGold', PERK_GOLD: 'PerkModel$$GetPerkGold',
         LARGEST_SOURCE: 'PlayerModel$$GetLargestGoldSourceAmount',
         MAX_STAGE: 'PlayerModel$$GetMaxServerStageReached'}
VARS = {'makeItRainStageMult': 0xA94, 'makeItRainMaxStageMult': 0xA98,
        'perkGoldReduction': 0xAA8}
# The gold sources GetLargestGoldSourceAmount takes a maximum over, as named by the calls it makes.
SOURCE_CALLS = ('MonsterModel$$GetAverageChestersonGoldDrop', 'MonsterModel$$GetAverageBossGoldDrop',
                'FairyController$$GetFairyGoldAmount', 'PetModel$$GetPetHomGold')


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

    def fact(address):
        return {'name': symbols[address], 'rva': hex(address), 'bytesSha256': sha(body(address))}

    def calls(listing):
        """Named calls in order. The unnamed trailing branch is il2cpp's throw helper, not a step."""
        return [name for name in
                (symbols.get(int(i.op_str.lstrip('#'), 16), '') for i in listing
                 if i.mnemonic in ('bl', 'b') and i.op_str.startswith('#')) if name]

    for address, name in NAMES.items():
        if symbols.get(address) != name:
            raise ValueError(f'method identity mismatch at {address:#x}: {symbols.get(address)!r}')

    variables = re.search(r'^public class ServerVarsModel(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)
    for name, offset in VARS.items():
        match = re.search(r'public static \S+ '+name+r'; // 0x([0-9A-Fa-f]+)', variables)
        if not match or int(match.group(1), 16) != offset:
            raise ValueError(f'{name} is no longer at {offset:#x}')

    # 1. Make It Rain picks a stage, then hands it to the shared perk-gold routine.
    rain = instructions(RAIN_GOLD)
    rain_calls = calls(rain)
    for name in (symbols[MAX_STAGE], symbols[PERK_GOLD]):
        if name not in rain_calls:
            raise ValueError(f'GetMakeItRainGold no longer calls {name}')
    if rain_calls[-1] != symbols[PERK_GOLD]:
        raise ValueError('GetMakeItRainGold no longer ends by calling GetPerkGold')
    rain_text = '\n'.join(f'{i.mnemonic} {i.op_str}' for i in rain)
    for offset, name in ((VARS['makeItRainMaxStageMult'], 'the gap weighting'),
                         (VARS['makeItRainStageMult'], 'the current-stage weighting')):
        if not re.search(r'ldr s\d+, \[x\d+, #'+f'{offset:#x}'+r'\]', rain_text):
            raise ValueError(f'GetMakeItRainGold no longer reads {name}')
    for needed, why in ((r'sub w\d+, w\d+, w\d+', 'the highest-minus-current subtraction'),
                        (r'fmul s\d+, s\d+, s\d+', 'the weighting multiply'),
                        (r'fadd s\d+, s\d+, s\d+', 'adding the current stage back'),
                        (r'fcsel s\d+, s\d+, s\d+', 'the pick between the two candidates')):
        if not re.search(needed, rain_text):
            raise ValueError(f'GetMakeItRainGold no longer contains {why}')

    # 2. The payout itself: the best gold source at that stage, times a bonus, raised to a power.
    perk = instructions(PERK_GOLD)
    perk_calls = calls(perk)
    for name in (symbols[LARGEST_SOURCE], 'BonusModel$$GetBonus', 'GHDouble$$op_Multiply'):
        if name not in perk_calls:
            raise ValueError(f'GetPerkGold no longer calls {name}')
    if perk_calls[-1] != 'GHDouble$$Pow':
        raise ValueError(f'GetPerkGold no longer ends in GHDouble.Pow: {perk_calls[-1]}')
    asked = None
    for index, instruction in enumerate(perk):
        if (instruction.mnemonic == 'bl' and instruction.op_str.startswith('#')
                and int(instruction.op_str.lstrip('#'), 16) == GET_BONUS):
            asked = next((int(earlier.op_str.split('#')[1], 0) for earlier in reversed(perk[:index])
                          if earlier.mnemonic == 'mov'
                          and re.fullmatch(r'w1, #\d+|w1, #0x[0-9a-f]+', earlier.op_str)), None)
            break
    types = re.search(r'public enum BonusType(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)
    bonus_names = {int(value): name for name, value
                   in re.findall(r'public const BonusType (\w+) = (\d+);', types)}
    if bonus_names.get(asked) != 'PerkGold':
        raise ValueError(f'GetPerkGold multiplies by {bonus_names.get(asked)!r}, expected PerkGold')
    # The exponent is perkGoldReduction, loaded right before the Pow and widened to a double.
    perk_text = '\n'.join(f'{i.mnemonic} {i.op_str}' for i in perk)
    if not re.search(r'ldr s\d+, \[x\d+, #0xaa8\]', perk_text) or 'fcvt d0, s0' not in perk_text:
        raise ValueError('perkGoldReduction is no longer the exponent of the final Pow')

    # 3. Why it is out of reach: what the gold source itself depends on.
    largest = instructions(LARGEST_SOURCE)
    largest_calls = calls(largest)
    missing = [name for name in SOURCE_CALLS if name not in largest_calls]
    if missing:
        raise ValueError(f'GetLargestGoldSourceAmount no longer consults {missing}')
    if 'GHDouble$$Max' not in largest_calls:
        raise ValueError('GetLargestGoldSourceAmount no longer takes a maximum')
    dependencies = []
    for name in largest_calls:
        if name and 'Singleton' not in name and 'GHDouble' not in name and name not in dependencies:
            dependencies.append(name)

    defaults = json.loads((ROOT/'reference/tt2/8.2.0/servervar-defaults.json')
                          .read_text(encoding='utf-8'))['recovered']
    values = {}
    for name in VARS:
        if name not in defaults:
            raise ValueError(f'{name} has no recovered default; run audit-servervar-defaults.py first')
        values[name] = defaults[name]['value']

    document = {
        'version': '8.2.0',
        'role': '黃金雨立即金幣的原生形狀：關卡怎麼挑、金額怎麼算，以及它為什麼接不上。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': f'兩個方法都短。GetMakeItRainGold 先挑一個關卡——把「歷史最高 − 目前」的差額乘上 '
                   f'makeItRainMaxStageMult（{values["makeItRainMaxStageMult"]}）再加回目前關卡，'
                   f'和 makeItRainStageMult（{values["makeItRainStageMult"]}）× 目前關卡兩者取其一'
                   f'（fcsel 挑，等於偏向較大的那個）——再交給 GetPerkGold。'
                   f'GetPerkGold 則是 (GetLargestGoldSourceAmount(關卡) × Bonus(PerkGold)) ^ '
                   f'perkGoldReduction（{values["perkGoldReduction"]}）。'
                   f'**所以金額根本不是關卡的函數**：它是「玩家在那個關卡最大的單一金幣來源值多少」，'
                   f'再開一個略小於 1 的次方壓下來。',
        'consequence': f'接不上，而且原因很具體：GetLargestGoldSourceAmount 有 {len(largest)} 條指令，'
                       f'對四個金幣來源取最大值（寶箱泰坦、頭目、妖精、寵物點金手），'
                       f'還要 GetMaxHandOfMidasBonus 與一次 QTE 解鎖檢查。'
                       f'這四條本專案沒有一條是照原生算的，所以先還原它們才談得上黃金雨的立即金幣。',
        'methods': {'makeItRainGold': fact(RAIN_GOLD), 'perkGold': fact(PERK_GOLD)},
        'stagePick': {
            'formula': 'max(makeItRainMaxStageMult × (歷史最高 − 目前) + 目前, '
                       'makeItRainStageMult × 目前)',
            'coefficients': {name: {'offset': hex(VARS[name]), 'value': values[name]}
                             for name in ('makeItRainStageMult', 'makeItRainMaxStageMult')},
            'note': f'兩個係數的預設值是 {values["makeItRainStageMult"]} 與 '
                    f'{values["makeItRainMaxStageMult"]}，所以實際上是「目前關卡，'
                    f'外加還沒推回去的那段的 85%」。挑法用兩層 fcsel，未逐一判定每個條件碼，'
                    f'只確認兩個候選值都算得出來。',
        },
        'payout': {
            'formula': '(GetLargestGoldSourceAmount(關卡, useMaxHandOfMidas: true) × Bonus(PerkGold)) '
                       '^ perkGoldReduction',
            'bonus': {'name': 'PerkGold', 'value': asked},
            'exponent': {'name': 'perkGoldReduction', 'offset': hex(VARS['perkGoldReduction']),
                         'value': values['perkGoldReduction']},
            'note': '指數略小於 1，作用是把很大的金幣值壓低——數字愈大壓得愈多。'
                    'GetPerkGold 同時也是公會箱金幣走的那條路徑。',
        },
        'blockedBy': {
            'method': symbols[LARGEST_SOURCE],
            'instructionCount': len(largest),
            'sources': list(SOURCE_CALLS),
            'alsoNeeds': [name for name in dependencies if name not in SOURCE_CALLS],
            'note': '它對四個來源取 GHDouble.Max，本專案這四條都不是照原生算的：'
                    '寶箱與頭目金幣沿用近似、妖精獎勵是另一套、寵物點金手未實作。',
        },
        'limits': [
            '三個係數都是 [ServerVar]，本表用的是編譯期預設值，不是線上值',
            'GetMakeItRainGold 的兩層 fcsel 未逐一判定條件碼，只確認兩個候選值的算法',
            'GetLargestGoldSourceAmount 本身未展開，只記下它呼叫了哪些來源與取最大值',
            '相鄰的 perkGoldSkillPointBase（1.04）與 perkGoldSkillPointMaxCount（400）'
            '不在這兩個方法裡，用途未查',
        ],
    }
    target = ROOT/'reference/tt2/8.2.0/perk-gold-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Read the Make It Rain gold shape: stage pick weights the gap by '
          f'{values["makeItRainMaxStageMult"]}, payout is (largest gold source x Bonus(PerkGold)) ^ '
          f'{values["perkGoldReduction"]}. Blocked by GetLargestGoldSourceAmount '
          f'({len(largest)} instructions over {len(SOURCE_CALLS)} gold sources).')


if __name__ == '__main__':
    main()
