"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

The engine's two resource perks came from the 7.5 PerkInfo and were never checked against 8.2.
They turn out to be checkable in full. PerkInfo.json ships the same four-step amounts and the same
12-hour duration, and the surrounding rules are short enough to read instruction by instruction:

    PerkModel.CurrentMaxPerkStackAllowed = 3 + (Bonus(PerkMaxLevel) > 0 ? 1 : 0), hard cap
        MAX_PERK_STACK = 4, which is also the fixed length of ActivePerkInfo.timers
    ActivePerkInfo.GetBonusAmountA(stackCount) = multiplier * bonusAmountA[clamp(stackCount-1)]
        where the multiplier is 1 for every perk except Make It Rain, which gets
        1 - min(Bonus(AutoBuyHeroesMultDuringMakeItRain), autoBuyHeroesMaxBonus)
    ActivePerkModel.ActivatePerk, when already at the stack limit, calls RemoveOldestStack and
        adds the new stack anyway — it does not refuse the activation
    ActivePerkModel.RunPerkTimer subtracts the elapsed time from each stack's own timer

This pins each of those shapes and publishes what the engine has to match.
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

MAX_STACK_ALLOWED = 0x2383D18    # PerkModel.get_CurrentMaxPerkStackAllowed()
EXTRA_UNLOCKED = 0x23822F0       # PerkModel.get_ExtraPerkUnlocked()
BONUS_AMOUNT_A = 0x211EF28       # ActivePerkInfo.GetBonusAmountA(int stackCount)
PERK_AMOUNT = 0x211E940          # ActivePerkModel.GetPerkAmount(PerkID, bool useSecondary)
ACTIVATE = 0x211E294             # ActivePerkModel.ActivatePerk(PerkID)
REMOVE_OLDEST = 0x211E508        # ActivePerkInfo.RemoveOldestStack()
SHIFT_TIMERS = 0x211E5AC         # ActivePerkInfo.ShiftTimersAndCountStack()
RUN_TIMER = 0x211D334            # ActivePerkModel.RunPerkTimer(float timeElapsed)
GET_BONUS = 0x2714C88            # BonusModel.GetBonus(BonusType, ...)

NAMES = {
    MAX_STACK_ALLOWED: 'PerkModel$$get_CurrentMaxPerkStackAllowed',
    EXTRA_UNLOCKED: 'PerkModel$$get_ExtraPerkUnlocked',
    BONUS_AMOUNT_A: 'ActivePerkInfo$$GetBonusAmountA',
    PERK_AMOUNT: 'ActivePerkModel$$GetPerkAmount',
    ACTIVATE: 'ActivePerkModel$$ActivatePerk',
    REMOVE_OLDEST: 'ActivePerkInfo$$RemoveOldestStack',
    SHIFT_TIMERS: 'ActivePerkInfo$$ShiftTimersAndCountStack',
    RUN_TIMER: 'ActivePerkModel$$RunPerkTimer',
}
# ServerVarsModel statics the perk paths read, by offset in the statics block.
SERVER_VARS = {'autoBuyHeroesMaxBonus': 0x734, 'perkDiamondCost': 0xACC, 'perkTicketCost': 0xAC4,
               'perkSelectUnlockStage': 0xAAC}
# The two perks this project implements, and the engine constants they have to match.
ENGINE_PERKS = {'ManaPotion': {'values': [1.5, 1.75, 2, 2.25], 'bonus': 'AllManaGained'},
                'MakeItRain': {'values': [45, 15, 5, 3], 'bonus': 'AutoBuyHeroes'}}


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

    def bonus_asks(listing):
        """Which BonusType each BonusModel.GetBonus call asks for: the w1 set closest above it."""
        asked = []
        for index, instruction in enumerate(listing):
            if (instruction.mnemonic != 'bl' or not instruction.op_str.startswith('#')
                    or int(instruction.op_str.lstrip('#'), 16) != GET_BONUS):
                continue
            argument = next((int(earlier.op_str.split('#')[1], 0) for earlier in reversed(listing[:index])
                             if earlier.mnemonic == 'mov' and re.fullmatch(r'w1, #\d+|w1, #0x[0-9a-f]+',
                                                                          earlier.op_str)), None)
            asked.append(argument)
        return asked

    for address, name in NAMES.items():
        if symbols.get(address) != name:
            raise ValueError(f'method identity mismatch at {address:#x}: {symbols.get(address)!r}')

    # Enum values, so a renumbered PerkID or BonusType fails loudly instead of silently
    # changing which branch the disassembly below is being read as.
    def enum_values(kind):
        block = re.search(r'public enum '+kind+r'(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)
        return {name: int(value) for name, value in
                re.findall(r'public const '+kind+r' (\w+) = (-?\d+);', block)}

    perk_ids, bonus_types = enum_values('PerkID'), enum_values('BonusType')
    if perk_ids.get('MakeItRain') != 1:
        raise ValueError(f'PerkID.MakeItRain is {perk_ids.get("MakeItRain")}, not 1')
    perk_max_level, rain_mult = bonus_types['PerkMaxLevel'], bonus_types['AutoBuyHeroesMultDuringMakeItRain']

    # ActivePerkInfo's field offsets, so a reshuffled class fails loudly.
    info = re.search(r'^public class ActivePerkInfo(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)
    fields = {name: int(offset, 16) for kind, name, offset in
              re.findall(r'public (\S+) (\w+); // 0x([0-9A-Fa-f]+)', info)}
    for name, offset, kind in (('timers', 0x38, 'double[]'), ('stackCount', 0x44, 'int'),
                               ('bonusAmountA', 0x20, 'double[]'), ('duration', 0x40, 'float')):
        if fields.get(name) != offset:
            raise ValueError(f'ActivePerkInfo.{name} moved from {offset:#x} to {fields.get(name)}')

    model = re.search(r'^public class PerkModel(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)
    max_stack = re.search(r'public const int MAX_PERK_STACK = (\d+);', model)
    if not max_stack:
        raise ValueError('PerkModel.MAX_PERK_STACK is gone')
    max_stack = int(max_stack.group(1))

    variables = re.search(r'^public class ServerVarsModel(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)
    for name, offset in SERVER_VARS.items():
        if not re.search(r'public static (?:int|float) '+name+r'; // 0x0*'+f'{offset:X}'+r';?\s*$',
                         variables, re.M | re.I):
            match = re.search(r'public static (\S+) '+name+r'; // 0x([0-9A-Fa-f]+)', variables)
            if not match or int(match.group(2), 16) != offset:
                raise ValueError(f'{name} is no longer at {offset:#x}')

    # 1. The stack limit: 3, plus one when the PerkMaxLevel bonus is above zero.
    limit_ops = [(i.mnemonic, i.op_str) for i in instructions(MAX_STACK_ALLOWED)]
    if ('bl', f'#{EXTRA_UNLOCKED:#x}') not in limit_ops:
        raise ValueError('CurrentMaxPerkStackAllowed no longer calls ExtraPerkUnlocked')
    base_stack = next((int(op.split('#')[1]) for name, op in limit_ops
                       if name == 'mov' and re.fullmatch(r'w\d+, #\d+', op)), None)
    if base_stack != 3 or not any(name == 'cinc' for name, _ in limit_ops):
        raise ValueError(f'stack limit is no longer "{base_stack} then conditionally +1"')

    # 2. Which bonus unlocks the extra stack, and that it is a strict "> 0" test.
    unlock = instructions(EXTRA_UNLOCKED)
    asked = bonus_asks(unlock)
    if asked != [perk_max_level]:
        raise ValueError(f'ExtraPerkUnlocked asks for bonuses {asked}, expected [{perk_max_level}]')
    if not any(i.mnemonic == 'bl' and 'op_GreaterThan' in symbols.get(int(i.op_str.lstrip('#'), 16), '')
               for i in unlock if i.mnemonic == 'bl' and i.op_str.startswith('#')):
        raise ValueError('ExtraPerkUnlocked no longer ends in a greater-than comparison')

    # 3. How a stack count becomes an index, and the Make It Rain multiplier in front of it.
    amount = instructions(BONUS_AMOUNT_A)
    rain_asked = bonus_asks(amount)
    if rain_asked != [rain_mult]:
        raise ValueError(f'GetBonusAmountA asks for bonuses {rain_asked}, expected [{rain_mult}]')
    text = '\n'.join(f'{i.mnemonic} {i.op_str}' for i in amount)
    for needed, why in ((r'cmp w\d+, #1\b', 'the PerkID.MakeItRain test'),
                        (r'ldr s\d+, \[x\d+, #0x734\]', 'the autoBuyHeroesMaxBonus cap'),
                        (r'fcsel s\d+, s\d+, s\d+, mi', 'the min() against that cap'),
                        (r'fsub d\d+, d\d+, d\d+', 'the 1 - bonus'),
                        (r'fmul d\d+, d\d+, d\d+', 'the multiply into the table amount')):
        if not re.search(needed, text):
            raise ValueError(f'GetBonusAmountA no longer contains {why}')
    # index = stackCount-1, floored at 0 and clamped to the last slot when the array is shorter.
    if not re.search(r'subs w\d+, w\d+, #1', text) or not re.search(r'sub w\d+, w\d+, #1', text):
        raise ValueError('GetBonusAmountA no longer clamps the index')

    # 4. A full stack does not refuse the activation; it drops the oldest stack first.
    activate = [int(i.op_str.lstrip('#'), 16) for i in instructions(ACTIVATE)
                if i.mnemonic == 'bl' and i.op_str.startswith('#')]
    for address, why in ((MAX_STACK_ALLOWED, 'read the stack limit'),
                         (REMOVE_OLDEST, 'drop the oldest stack'),
                         (SHIFT_TIMERS, 'recount the stack')):
        if address not in activate:
            raise ValueError(f'ActivatePerk no longer calls {symbols[address]} to {why}')

    # 5. RemoveOldestStack sorts the live timers and clears the last one.
    oldest = '\n'.join(f'{i.mnemonic} {i.op_str}' for i in instructions(REMOVE_OLDEST))
    if not re.search(r'fcmp d\d+, d\d+', oldest) or not re.search(r'stp d\d+, d\d+', oldest):
        raise ValueError('RemoveOldestStack no longer orders the timers')

    # 6. The timer array is a fixed four slots, walked one stack at a time.
    shift = instructions(SHIFT_TIMERS)
    span = next((int(i.op_str.split('#')[1], 0) for i in shift
                 if i.mnemonic == 'cmp' and re.fullmatch(r'x\d+, #0x[0-9a-f]+', i.op_str)), None)
    if span != max_stack*8:
        raise ValueError(f'ShiftTimersAndCountStack walks {span} bytes, not {max_stack} doubles')
    ticking = '\n'.join(f'{i.mnemonic} {i.op_str}' for i in instructions(RUN_TIMER))
    if not re.search(r'fsub d\d+, d\d+, d\d+', ticking) or f'#{SHIFT_TIMERS:#x}' not in ticking:
        raise ValueError('RunPerkTimer no longer ticks each timer down and recounts')

    # The table and the compiled-in defaults the engine is being checked against.
    perk_table = json.loads((ROOT/'reference/tt2/8.2.0/PerkInfo.json').read_text(encoding='utf-8'))
    rows = {row['values']['PerkID']: row['values'] for row in perk_table['records']}
    defaults = json.loads((ROOT/'reference/tt2/8.2.0/servervar-defaults.json')
                          .read_text(encoding='utf-8'))['recovered']
    values = {}
    for name in SERVER_VARS:
        if name not in defaults:
            raise ValueError(f'{name} has no recovered default; run audit-servervar-defaults.py first')
        values[name] = defaults[name]['value']

    perks = {}
    for perk, expected in ENGINE_PERKS.items():
        row = rows.get(perk)
        if row is None:
            raise ValueError(f'PerkInfo no longer has {perk}')
        amounts = [float(row[f'A{step}']) for step in (1, 2, 3, 4)]
        if amounts != [float(n) for n in expected['values']]:
            raise ValueError(f'{perk} amounts are {amounts}, engine uses {expected["values"]}')
        if row['BonusTypeA'] != expected['bonus']:
            raise ValueError(f'{perk} grants {row["BonusTypeA"]}, engine assumes {expected["bonus"]}')
        perks[perk] = {'bonusTypeA': row['BonusTypeA'], 'amounts': amounts,
                       'durationSeconds': float(row['Duration']), 'baseCost': float(row['BaseCost']),
                       'runWhileInactive': row['RunWhileInactive'] == 'TRUE'}
    durations = {perk['durationSeconds'] for perk in perks.values()}
    if durations != {43200.0}:
        raise ValueError(f'perk durations are {durations}, engine uses 12 hours')

    cap = values['autoBuyHeroesMaxBonus']
    document = {
        'version': '8.2.0',
        'role': '增益 perks 的原生規則：層數上限、每層計時、層數如何變成索引、黃金雨的專屬修正，'
                '以及本專案兩個 perk 在 8.2 資料表裡的值。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': f'PerkInfo 的 ManaPotion 與 MakeItRain 兩列在 8.2 與本專案沿用的 7.5 值完全相同'
                   f'（{perks["ManaPotion"]["amounts"]} 與 {perks["MakeItRain"]["amounts"]}，'
                   f'各 43200 秒、基礎費用 100），層數上限也對得上：'
                   f'PerkModel.CurrentMaxPerkStackAllowed 是 {base_stack}，'
                   f'Bonus(PerkMaxLevel) 大於 0 時加一，硬上限 MAX_PERK_STACK = {max_stack}，'
                   f'同時就是 ActivePerkInfo.timers 的固定格數；'
                   f'GetBonusAmountA 以 stackCount−1 當索引並夾在 0 與最後一格之間。'
                   f'兩處本專案沒有照做：滿層時原生不是拒絕，而是先 RemoveOldestStack 再加新的一層；'
                   f'黃金雨的間隔另外乘上 1 − min(Bonus(AutoBuyHeroesMultDuringMakeItRain), {cap})。',
        'consequence': 'ManaPotion 與 MakeItRain 的數值、時長、費用與層數上限都可由 baseline-75 升為 '
                       'table／default；滿層行為與黃金雨修正則是引擎要補的兩處差異。',
        'methods': {key: fact(address) for key, address in
                    (('stackLimit', MAX_STACK_ALLOWED), ('extraStackUnlocked', EXTRA_UNLOCKED),
                     ('bonusAmountA', BONUS_AMOUNT_A), ('perkAmount', PERK_AMOUNT),
                     ('activate', ACTIVATE), ('removeOldestStack', REMOVE_OLDEST),
                     ('shiftTimers', SHIFT_TIMERS), ('runPerkTimer', RUN_TIMER))},
        'stackLimit': {
            'base': base_stack,
            'extraStackBonus': {'name': 'PerkMaxLevel', 'value': perk_max_level,
                                'test': 'Bonus(PerkMaxLevel) > 0，是布林而非累加'},
            'hardCap': max_stack,
            'timerSlots': span//8,
            'note': f'上限是 {base_stack}，解鎖後 {base_stack+1}；MAX_PERK_STACK = {max_stack} 同時是 '
                    f'timers 陣列的固定長度，所以引擎的 min(4, 3 + PerkMaxLevel) 與原生等價。',
        },
        'indexing': {
            'formula': 'bonusAmountA[min(max(stackCount - 1, 0), 長度 - 1)]',
            'note': '原生先取 stackCount−1，小於 0 時退回第 0 格，陣列比 stackCount 短時夾到最後一格，'
                    '與引擎的 values[min(3, n−1)] 相同。',
        },
        'makeItRainMultiplier': {
            'bonus': {'name': 'AutoBuyHeroesMultDuringMakeItRain', 'value': rain_mult},
            'cap': {'name': 'autoBuyHeroesMaxBonus', 'offset': hex(SERVER_VARS['autoBuyHeroesMaxBonus']),
                    'value': cap},
            'formula': f'間隔 = A[層數] × (1 − min(Bonus(AutoBuyHeroesMultDuringMakeItRain), {cap}))',
            'note': 'GetBonusAmountA 只對 PerkID.MakeItRain（值 1）走這一段，其餘 perk 的乘數是 1。'
                    '包內給這個加成的是 GoldRain 傳說套裝（0.3），所以湊齊該套裝時間隔只剩七成。'
                    'ManaPotion 不受影響。',
        },
        'stackingWhenFull': {
            'native': '滿層時 ActivatePerk 呼叫 RemoveOldestStack（把仍在跑的計時器排序後清掉剩最少的那格、'
                      'stackCount 減一），再把新的一層寫進 timers，最後 ShiftTimersAndCountStack 重新壓縮計數。',
            'consequence': '層數不變，但等於用一張票把最短的一層換成完整時長；引擎目前是直接拒絕。',
        },
        'timers': {
            'perStack': True,
            'note': 'RunPerkTimer 對每一層各自扣掉經過時間，歸零的格子由 ShiftTimersAndCountStack 壓掉，'
                    '整個 perk 的層數歸零後才從 activatedPerks 移除——每層獨立計時確認無誤。',
        },
        'perks': perks,
        'serverVarDefaults': {name: {'offset': hex(SERVER_VARS[name]), 'value': values[name]}
                              for name in SERVER_VARS},
        'notImplemented': {
            'perkSelectUnlockStage': f'原生的 perk 隨機配發（PerkModel.SelectablePerks 與 '
                                     f'PerkSelectPanelScript）在第 {values["perkSelectUnlockStage"]} 關解鎖，'
                                     f'本專案兩個 perk 固定可用，未還原選擇機制。',
            'perkTicketCost': f'原生另有 perk 票券（perkTicketCost = {values["perkTicketCost"]}），'
                              f'本專案的兌換次數來自登入獎勵，兩者節奏不同。',
            'immediateGold': 'MakeItRain 的立即金幣走 PerkModel.GetMakeItRainGold，以 makeItRainStageMult '
                             '與 makeItRainMaxStageMult 兩個係數配合目前關卡與歷史最高關卡計算，尚未還原。',
            'otherPerks': f'PerkInfo 共 {len(rows)} 列，本專案只實作其中兩列。',
        },
        'limits': [
            'perkDiamondCost 與 autoBuyHeroesMaxBonus 都是 [ServerVar]，本表用的是編譯期預設值，不是線上值',
            'GetBonusAmountB 未逐指令讀完；本專案兩個 perk 的 BonusTypeB 都是 None，用不到',
            'Doom 的 DoomBonusTimeUntilMaxDamage 等其他 perk 的專屬路徑未查',
            'ActivatePerk 另有 VideoAllDamage（PerkID 6）在 VIP 或季票下一次填滿所有層數的捷徑，與本專案無關',
        ],
    }
    target = ROOT/'reference/tt2/8.2.0/perk-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Verified the perk rules: stack limit {base_stack} (+1 unlocked, hard cap {max_stack}), '
          f'{span//8} timer slots, Make It Rain multiplier capped at {cap}; '
          f'ManaPotion {perks["ManaPotion"]["amounts"]} and MakeItRain {perks["MakeItRain"]["amounts"]} '
          f'match the engine.')


if __name__ == '__main__':
    main()
