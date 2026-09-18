"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

Special titans are not a kind of monster, they are a stack of timed effects. SpecialTitanScript
keeps a Queue<int> whose elements are "stages this stack has left": defeating one enqueues
StageEffectLength, clearing a stage decrements every element and drops the ones that reach zero,
and NumOfStacks is simply the queue's length. That is the whole state machine, and it is what makes
the four bonuses in this system mean anything.

This walks the methods that make it up and pins each one instruction by instruction:

  * the spawn roll       - Random.value < GetSpawnChance(), gated by CanSpawnTitan()
  * Snap's spawn chance  - MegaBombSpawnChance x SpecialTitanSpawnChance x AllProbabilityBoost
  * Chesterson's         - ChestChance x SpecialTitanSpawnChance x AllProbabilityBoost
  * Snap's stack length  - floor(megaBombMonsterMaxStageEffectAmount x SpecialTitanStackDurationMult)
  * Snap's stack cap     - (int)MegaBombMaxStacks
  * defeat               - enqueue the length, then drop the oldest while over the cap
  * a stage passing      - decrement every element, drop what reaches zero
  * Snap's effect        - the stage's titan count x pow(megaBombMonsterTitanRemovalPercent, stacks)
  * Chesterson's chance  - ChestChance x SpecialTitanSpawnChance x AllProbabilityBoost
  * Chesterson's gate    - one stack at most, and only after a prestige
  * Chesterson's length  - floor((ChestersonGoldStageAmount + chestersonGoldDuration) x duration mult)
  * Chesterson's effect  - while the stack is up, NewMonster hands out MonsterClass.Chesterson
  * Chesterson's gold    - treasureGold x ChestAmount

The two titans share the template but not the effect: Snap thins the stage out, Chesterson turns
every ordinary titan in it into a treasure one. Hayst and Kratos use the template too but belong to
builds this project has not implemented.
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

GET_BONUS = 0x2714C88
METHODS = {
    'chestersonChance': (0x2537B44, 'ChestersonTitanScript$$GetSpawnChance'),
    'megaBombChance': (0x253A9E0, 'MegaBombTitanScript$$GetSpawnChance'),
    'megaBombStackLength': (0x253A404, 'MegaBombTitanScript$$get_StageEffectLength'),
    'megaBombStackCap': (0x253A360, 'MegaBombTitanScript$$get_MaxStackCount'),
    'roll': (0x253C200, 'SpecialTitanScript$$RollSpawnMonster'),
    'defeat': (0x253918C, 'SpecialTitanScript$$PerformDefeatAction'),
    'push': (0x253C258, 'SpecialTitanScript$$PushEndEffectToQueue'),
    'stagePassed': (0x253C338, 'SpecialTitanScript$$UpdateEffectEnd'),
    'canSpawn': (0x253A9A8, 'MegaBombTitanScript$$CanSpawnTitan'),
    'atMaxStacks': (0x2537B0C, 'SpecialTitanScript$$IsAtMaxStacks'),
    'effectActive': (0x2538380, 'SpecialTitanScript$$IsEffectActive'),
    'titanCount': (0x2546594, 'StageLogic$$GetMonsterCountPerStage'),
    'chestersonStackCap': (0x2537938, 'ChestersonTitanScript$$get_MaxStackCount'),
    'chestersonGate': (0x2537A84, 'ChestersonTitanScript$$CanSpawnTitan'),
    'chestersonStackLength': (0x2537940, 'ChestersonTitanScript$$get_StageEffectLength'),
    'chestersonClass': (0x231DF20, 'MonsterModel$$NewMonster'),
    'chestersonGold': (0x271852C, 'BonusModel$$GetChestersonMultiplier'),
}

# ServerVarsModel statics this system reads directly rather than through a bonus.
STATICS = {0xA00: ('megaBombMonsterMaxStageEffectAmount', 'int'),
           0x9F8: ('megaBombMonsterTitanRemovalPercent', 'float'),
           0xA04: ('chestersonGoldDuration', 'int'),
           0x9E4: ('treasureGold', 'float')}

BONUS_IDS = {'MegaBombSpawnChance': 330, 'MegaBombMaxStacks': 331,
             'SpecialTitanSpawnChance': 424, 'SpecialTitanStackDurationMult': 425,
             'ChestChance': 100, 'AllProbabilityBoost': 27,
             'ChestersonGoldStageAmount': 101, 'ChestAmount': 97}

# MonsterClass values, checked against the enum rather than trusted from here.
CHESTERSON_CLASS = 3

# Bases from BonusModel.SetDefaultBonuses, published by audit-bonus-defaults.py.
BASE_OF = {'MegaBombSpawnChance': 'megaBombMonsterSpawnChance',
           'MegaBombMaxStacks': 'megaBombBaseStacks'}

# Singleton plumbing and Unity lifetime checks; none of it is arithmetic.
NOISE = {'get_instance', 'op_Inequality', 'get_currentStage'}

# The one unnamed helper this system calls. It is the PLT thunk every pow() in the binary goes
# through - GammaToLinear, easing curves and the exponential backoff policy all land on it - so it
# is identified by its callers rather than by a symbol, which the stripped binary does not carry.
POW_THUNK = 0x49DF500
POW_WITNESSES = {'TMPro.TMPro_ExtensionMethods$$GammaToLinear',
                 'UnityEngine.Purchasing.ExponentialBackOffRetryPolicy$$AdjustDelay'}

# The two vtable slots this system calls through. MaxStackCount is fixed by CanSpawnTitan and
# IsAtMaxStacks, whose dump.cs bodies are both "NumOfStacks vs MaxStackCount"; StageEffectLength
# is the next slot up, which matches dump.cs declaring the two properties adjacent and in that
# order. An il2cpp vtable entry is a {method, methodInfo} pair, hence the 0x10 stride.
MAX_STACK_SLOT = '0x1b8'
STAGE_LENGTH_SLOT = '0x1c8'


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

    def body(address, cap=0x1000):
        following = next((a for a in starts if a > address), address+cap)
        return read(address, min(following-address, cap))

    def fact(address):
        return {'name': symbols[address], 'rva': hex(address), 'bytesSha256': sha(body(address))}

    for key, (address, name) in METHODS.items():
        if symbols.get(address) != name:
            raise ValueError(f'{key}: expected {name} at {address:#x}, found {symbols.get(address)!r}')

    if not re.search(r'public const MonsterClass Chesterson = '+str(CHESTERSON_CLASS)+r';', dump):
        raise ValueError(f'MonsterClass.Chesterson is no longer {CHESTERSON_CLASS}')

    enum = json.loads((ROOT/'reference/tt2/8.2.0/native-bonus-types.json').read_text(encoding='utf-8'))
    for name, wanted in BONUS_IDS.items():
        if int(enum['values'][name]) != wanted:
            raise ValueError(f'{name} is {enum["values"][name]}, not {wanted}')
    by_id = {value: name for name, value in BONUS_IDS.items()}

    block = re.search(r'^public class ServerVarsModel(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)
    for offset, (field, kind) in STATICS.items():
        if not re.search(r'public static '+kind+' '+field+r'; // 0x'+f'{offset:X}'+r'\b', block):
            raise ValueError(f'{field} is no longer a {kind} at {offset:#x}')

    # The pow thunk carries no symbol, so prove what it is from who else calls it.
    import bisect
    def owner(address):
        i = bisect.bisect_right(starts, address)-1
        return symbols[starts[i]] if i >= 0 else '?'
    callers = set()
    for segment in elf.iter_segments():
        if segment['p_type'] != 'PT_LOAD' or not segment['p_flags'] & 1:
            continue
        base = segment['p_vaddr']
        data = binary[segment['p_offset']:segment['p_offset']+segment['p_filesz']]
        for ins in machine.disasm(data, base):
            if ins.mnemonic == 'bl' and ins.op_str == f'#{POW_THUNK:#x}':
                callers.add(owner(ins.address))
    missing = POW_WITNESSES - callers
    if missing:
        raise ValueError(f'{POW_THUNK:#x} is not the pow thunk; these no longer call it: {missing}')

    def trace(address):
        """The ordered events that matter, so a long method is quoted rather than dumped."""
        events, pending, slot = [], None, None
        for ins in machine.disasm(body(address), address):
            if ins.mnemonic in ('ldp', 'ldr'):
                # The vtable fetch that precedes a virtual call: remember which slot it took.
                m = re.fullmatch(r'x9(?:, x\d+)?, \[x8, #(0x[0-9a-f]+)\]', ins.op_str)
                if m:
                    slot = m.group(1)
            if ins.mnemonic == 'blr':
                # A virtual call. The target is a vtable slot, so the instruction cannot name the
                # method - the slot offset is recorded instead, which is enough to show that two
                # calls go to the same method and that two different methods agree on one slot.
                events.append(('vcall', slot, hex(ins.address)))
            if ins.mnemonic == 'mov':
                m = re.fullmatch(r'w1, #(0x[0-9a-f]+|\d+)', ins.op_str)
                pending = int(m.group(1), 0) if m else pending
            elif ins.mnemonic == 'ldr':
                m = re.fullmatch(r'[sw]\d+, \[x\d+, #(0x[0-9a-f]+)\]', ins.op_str)
                if m and int(m.group(1), 16) in STATICS:
                    events.append(('static', STATICS[int(m.group(1), 16)][0], hex(ins.address)))
            elif ins.mnemonic in ('fmul', 'fadd', 'fcmp', 'fcvtms', 'scvtf', 'frintm',
                                  'sub', 'subs', 'add', 'cmp', 'cset', 'csel'):
                events.append((ins.mnemonic, ins.op_str, hex(ins.address)))
            elif ins.mnemonic == 'bl' and ins.op_str.startswith('#'):
                target = int(ins.op_str.lstrip('#'), 16)
                if target == GET_BONUS:
                    events.append(('GetBonus', by_id.get(pending, f'BonusType#{pending}'), hex(ins.address)))
                elif target == POW_THUNK:
                    events.append(('call', 'pow', hex(ins.address)))
                else:
                    name = symbols.get(target, '')
                    short = name.split('$$')[-1]
                    if name and short not in NOISE:
                        events.append(('call', short, hex(ins.address)))
            elif ins.mnemonic == 'b' and ins.op_str.startswith('#'):
                # Tail calls carry real meaning here: PushEndEffectToQueue ends in one.
                target = int(ins.op_str.lstrip('#'), 16)
                name = symbols.get(target, '')
                short = name.split('$$')[-1]
                if name and short not in NOISE:
                    events.append(('tail', short, hex(ins.address)))
            elif ins.mnemonic == 'br':
                # A virtual tail call. RollSpawnMonster ends in one - the gate it jumps to is
                # CanSpawnTitan, an abstract method, so the target is a vtable slot and the
                # instruction cannot name it. Recorded as "some virtual tail call" rather than
                # claimed to be the one we expect.
                events.append(('tail', 'virtual', hex(ins.address)))
        return events

    traces = {key: trace(address) for key, (address, _) in METHODS.items()}

    def kinds(key, first=None, last=None, keep=None):
        out = [(a, b) for a, b, at in traces[key]
               if (first is None or first <= int(at, 16) <= last)]
        return [e for e in out if keep is None or e[0] in keep] if keep else out

    def want(key, expected, **window):
        got = kinds(key, **window)
        if got != expected:
            raise ValueError(f'{key} changed shape:\n  got      {got}\n  expected {expected}')

    # --- the two spawn chances: same template, different first factor ---
    want('chestersonChance', [
        ('GetBonus', 'AllProbabilityBoost'), ('GetBonus', 'SpecialTitanSpawnChance'),
        ('GetBonus', 'ChestChance'), ('call', 'op_Multiply'), ('call', 'op_Multiply'),
        ('call', 'op_Explicit')], keep={'GetBonus', 'call'})
    want('megaBombChance', [
        ('GetBonus', 'AllProbabilityBoost'), ('GetBonus', 'SpecialTitanSpawnChance'),
        ('GetBonus', 'MegaBombSpawnChance'), ('call', 'op_Multiply'), ('call', 'op_Multiply'),
        ('call', 'op_Explicit')], keep={'GetBonus', 'call'})

    # --- how long one stack lasts, and how many stacks fit ---
    want('megaBombStackLength', [
        ('GetBonus', 'SpecialTitanStackDurationMult'), ('call', 'op_Explicit'),
        ('static', 'megaBombMonsterMaxStageEffectAmount'), ('scvtf', 's0, s0'),
        ('fmul', 's0, s8, s0'), ('frintm', 's1, s0'), ('fcvtms', 'w9, s0')],
        keep={'GetBonus', 'call', 'static', 'scvtf', 'fmul', 'fcvtms', 'frintm'})
    want('megaBombStackCap', [
        ('GetBonus', 'MegaBombMaxStacks'), ('call', 'op_Explicit')], keep={'GetBonus', 'call'})

    # --- the state machine ---
    # The gate after the roll is a virtual tail call; dump.cs is what names it CanSpawnTitan.
    want('roll', [('call', 'get_value'), ('fcmp', 's8, s0'), ('tail', 'virtual')],
         keep={'call', 'fcmp', 'tail'})
    if not re.search(r'public abstract bool CanSpawnTitan\(\);', dump):
        raise ValueError('CanSpawnTitan is no longer the abstract gate RollSpawnMonster jumps to')
    want('defeat', [('call', 'PushEndEffectToQueue')], keep={'call'})
    # Every virtual call here goes to StageEffectLength - including the one the count is compared
    # against. So the cap applied on defeat is the stack's own length, not MaxStackCount: an element
    # cannot outlive StageEffectLength stages anyway, so this only bites when several are defeated
    # in one stage. The real ceiling is enforced on the spawn side, by CanSpawnTitan.
    want('push', [('vcall', STAGE_LENGTH_SLOT), ('vcall', STAGE_LENGTH_SLOT), ('call', 'Enqueue'),
                  ('vcall', STAGE_LENGTH_SLOT), ('tail', 'Dequeue')],
         keep={'call', 'tail', 'vcall'})
    want('stagePassed', [('call', 'Count<int>'), ('call', 'Dequeue'), ('call', 'Enqueue')],
         keep={'call'})
    want('canSpawn', [('call', 'get_NumOfStacks'), ('vcall', MAX_STACK_SLOT), ('cset', 'w0, lt')],
         keep={'call', 'cset', 'vcall'})
    want('atMaxStacks', [('call', 'get_NumOfStacks'), ('vcall', MAX_STACK_SLOT), ('cset', 'w0, ge')],
         keep={'call', 'cset', 'vcall'})
    # dump.cs is what ties those slots to names, so fail loudly if it stops saying so.
    for prop in ('MaxStackCount', 'StageEffectLength'):
        if not re.search(r'public abstract int '+prop+r' \{ get; \}', dump):
            raise ValueError(f'{prop} is no longer an abstract int property')
    if MAX_STACK_SLOT >= STAGE_LENGTH_SLOT:
        raise ValueError('MaxStackCount should sit below StageEffectLength in the vtable')
    want('effectActive', [('call', 'Peek'), ('cset', 'w0, gt')], keep={'call', 'cset'})

    # UpdateEffectEnd's own arithmetic: one decrement, and the two comparisons that drop a stack.
    decrement = [e for e in traces['stagePassed'] if e[0] in ('sub', 'subs')]
    if [e[1] for e in decrement] != ['w1, w0, #1']:
        raise ValueError(f'the per-stage decrement changed: {decrement}')

    # --- the effect on the stage's titan count ---
    want('titanCount', [
        ('call', 'GetSpecialTitanScript'), ('call', 'IsEffectActive'), ('call', 'get_NumOfStacks'),
        ('scvtf', 's8, w0'), ('call', 'GetRawMonsterCountPerStage'),
        ('GetBonus', 'BonusType#334'), ('call', 'op_Explicit'), ('call', 'IsAnyContractActive'),
        ('GetBonus', 'BonusType#44'), ('call', 'op_Explicit'),
        ('static', 'megaBombMonsterTitanRemovalPercent'), ('call', 'pow'), ('scvtf', 's9, w22'),
        ('fmul', 's8, s8, s9'), ('frintm', 's0, s8'), ('fcvtms', 'w9, s8'),
        ('call', 'Max')], keep={'GetBonus', 'call', 'static', 'scvtf', 'fmul', 'frintm', 'fcvtms'})

    # --- Chesterson: one stack, only after a prestige, and it converts the whole stage ---
    # The cap is a constant, so there is nothing for the trace to see; read the two instructions.
    cap_body = list(machine.disasm(body(METHODS['chestersonStackCap'][0], 0x10),
                                   METHODS['chestersonStackCap'][0]))[:2]
    cap_shape = [(i.mnemonic, i.op_str) for i in cap_body]
    if cap_shape != [('mov', 'w0, #1'), ('ret', '')]:
        raise ValueError(f'Chesterson no longer caps at one stack: {cap_shape}')

    want('chestersonGate', [('call', 'get_NumOfStacks'), ('vcall', MAX_STACK_SLOT),
                            ('tail', 'HasPrestigedBefore')],
         keep={'call', 'vcall', 'tail'})
    want('chestersonStackLength', [
        ('GetBonus', 'ChestersonGoldStageAmount'), ('call', 'op_Explicit'),
        ('GetBonus', 'SpecialTitanStackDurationMult'), ('call', 'op_Explicit'),
        ('static', 'chestersonGoldDuration'), ('scvtf', 's0, s0'),
        ('fadd', 's0, s8, s0'), ('fmul', 's0, s9, s0'), ('frintm', 's1, s0'), ('fcvtms', 'w9, s0')],
        keep={'GetBonus', 'call', 'static', 'scvtf', 'fadd', 'fmul', 'frintm', 'fcvtms'})
    want('chestersonGold', [('static', 'treasureGold'), ('call', 'op_Implicit'),
                            ('GetBonus', 'ChestAmount'), ('call', 'op_Multiply')],
         keep={'static', 'call', 'GetBonus'})

    # The effect: a new titan's class becomes Chesterson while the stack is up. The two compares
    # before it are the classes that keep their own identity - Boss and StageSkipBoss.
    swap = [(a, b) for a, b, _ in traces['chestersonClass']][:6]
    expected_swap = [('sub', 'sp, sp, #0x110'), ('cmp', 'w20, #1'), ('cmp', 'w20, #6'),
                     ('call', 'GetStageSkipMonsterStagesSkipped'), ('call', 'IsMonsterEffectActive'),
                     ('csel', 'w27, w22, w20, ne')]
    if swap != expected_swap:
        raise ValueError(f'the class swap changed shape:\n  got      {swap}\n  expected {expected_swap}')
    # The class it swaps in is loaded into w22 just before the call; find that immediate.
    swap_at = int(next(at for a, b, at in traces['chestersonClass'] if b == 'IsMonsterEffectActive'), 16)
    loaded = [i for i in machine.disasm(read(swap_at-0x20, 0x24), swap_at-0x20)
              if i.mnemonic == 'mov' and i.op_str == f'w22, #{CHESTERSON_CLASS}']
    if not loaded:
        raise ValueError(f'the swapped-in class is not MonsterClass {CHESTERSON_CLASS}')

    defaults = json.loads((ROOT/'reference/tt2/8.2.0/bonus-defaults-evidence.json')
                          .read_text(encoding='utf-8'))['defaults']
    bases = {}
    for bonus, field in BASE_OF.items():
        entry = defaults.get(bonus)
        if not entry or entry['field'] != field:
            raise ValueError(f'{bonus} no longer defaults from {field}; rerun audit-bonus-defaults.py')
        bases[bonus] = {'field': field, 'value': entry['value']}

    servervars = json.loads((ROOT/'reference/tt2/8.2.0/servervar-defaults.json')
                            .read_text(encoding='utf-8'))['recovered']
    statics = {}
    for field, _ in STATICS.values():
        if field not in servervars:
            raise ValueError(f'{field} has no recovered default')
        statics[field] = servervars[field]['value']

    length = statics['megaBombMonsterMaxStageEffectAmount']
    removal = statics['megaBombMonsterTitanRemovalPercent']
    chance = bases['MegaBombSpawnChance']['value']
    caps = bases['MegaBombMaxStacks']['value']
    document = {
        'version': '8.2.0',
        'role': '特殊泰坦堆疊：佇列狀態機、兩個生成機率、炸彈泰坦的堆疊上限與持續關數，以及它對每關隻數的效果。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': '特殊泰坦不是一種怪，是一疊有期限的效果。SpecialTitanScript 帶一個 Queue<int>，'
                   '元素是「這一疊還剩幾關」：擊殺時 PushEndEffectToQueue 推入 StageEffectLength，'
                   '推完若長度超過 StageEffectLength 就 Dequeue 丟掉最舊的；每清掉一關 UpdateEffectEnd 把'
                   '每個元素減一、減到小於 1 的不再放回；NumOfStacks 就是佇列長度，'
                   'IsEffectActive 是「長度至少 1 且隊首大於 0」。生成走 RollSpawnMonster：'
                   'Random.value 小於 GetSpawnChance() 之後還要 CanSpawnTitan() 為真，'
                   '而炸彈泰坦的 CanSpawnTitan 就是 NumOfStacks < MaxStackCount——滿層就不再生成。'
                   '**層數上限是擋在生成端的**：擊殺那一側比對的是 StageEffectLength 而不是 '
                   'MaxStackCount（三次虛擬呼叫都走同一個 vtable 槽），那只是防止同一關打死多隻時'
                   '佇列無限增長的防護，真正的上限靠 CanSpawnTitan 不讓它生出來。'
                   '兩個生成機率是同一個模板：炸彈是 '
                   'MegaBombSpawnChance × SpecialTitanSpawnChance × AllProbabilityBoost，'
                   '寶箱是把第一項換成 ChestChance。炸彈的 StageEffectLength 是 '
                   f'floor({length} × SpecialTitanStackDurationMult)，MaxStackCount 是 '
                   f'(int)MegaBombMaxStacks（基底 {caps}）。效果在 GetMonsterCountPerStage 結尾：'
                   f'該關隻數乘上 pow({removal}, 堆疊層數) 再向下取整。'
                   '**寶箱泰坦用同一套佇列，但效果完全不同**：它的 MaxStackCount 是常數 1，'
                   'CanSpawnTitan 除了「還沒疊」還要求 PrestigeModel.HasPrestigedBefore()，'
                   f'一疊撐 floor((ChestersonGoldStageAmount + {statics["chestersonGoldDuration"]}) '
                   '× SpecialTitanStackDurationMult) 關；效果作用中，'
                   'MonsterModel.NewMonster 會把新生成泰坦的類別直接換成 MonsterClass.Chesterson'
                   '（Boss 與 StageSkipBoss 除外），也就是那幾關的每一隻都是寶箱泰坦。'
                   f'寶箱金幣的倍率是 BonusModel.GetChestersonMultiplier = treasureGold'
                   f'（{statics["treasureGold"]}）× ChestAmount。',
        'consequence': '**引擎目前的寶箱泰坦機率少了 SpecialTitanSpawnChance 這一項**，接上等於修正既有機制。'
                       '炸彈泰坦則是全新的：未投資的玩家上限 1 層，打死一隻之後的 '
                       f'{length} 關每關隻數乘 {removal}。三個基底與兩個靜態欄位都是 [ServerVar] 的'
                       '編譯期預設值，線上可覆蓋，狀態為 default。'
                       f'**引擎的寶箱金幣倍率一直寫死 10，原生是 treasureGold = '
                       f'{statics["treasureGold"]}**，接這一段時一併修正。'
                       '寶箱的跨關效果對金幣影響很大：未投資時一疊就有 '
                       f'{statics["chestersonGoldDuration"]} 關，那幾關的每一隻普通泰坦都是寶箱。',
        'methods': {key: fact(address) for key, (address, _) in METHODS.items()},
        'formulas': {
            'megaBombChance': 'MegaBombSpawnChance × SpecialTitanSpawnChance × AllProbabilityBoost',
            'chestersonChance': 'ChestChance × SpecialTitanSpawnChance × AllProbabilityBoost',
            'spawnGate': 'Random.value < GetSpawnChance() 且 NumOfStacks < MaxStackCount（滿層就不生成）',
            'stackLength': 'floor(megaBombMonsterMaxStageEffectAmount × SpecialTitanStackDurationMult)',
            'stackCap': '(int)MegaBombMaxStacks',
            'onDefeat': '推入 StageEffectLength；長度超過 StageEffectLength 就丟掉最舊的一疊',
            'onStageCleared': '每一疊減一關，減到小於 1 就移除',
            'titanCount': 'floor(該關隻數 × pow(megaBombMonsterTitanRemovalPercent, 堆疊層數))',
            'chestersonStackCap': '常數 1',
            'chestersonGate': 'NumOfStacks < 1 且 PrestigeModel.HasPrestigedBefore()',
            'chestersonStackLength': 'floor((ChestersonGoldStageAmount + chestersonGoldDuration) '
                                     '× SpecialTitanStackDurationMult)',
            'chestersonEffect': '效果作用中時 MonsterModel.NewMonster 把泰坦的類別換成 '
                                'MonsterClass.Chesterson；Boss 與 StageSkipBoss 保留自己的類別',
            'chestersonGold': 'treasureGold × ChestAmount',
        },
        'traces': traces,
        'bases': bases,
        'statics': {field: {'offset': hex(offset), 'value': statics[field]}
                    for offset, (field, _) in STATICS.items()},
        'bonusIds': BONUS_IDS,
        'powThunk': {'rva': hex(POW_THUNK), 'identifiedBy': sorted(POW_WITNESSES),
                     'callers': len(callers)},
        'limits': [
            'pow 的那個 thunk 在這份 binary 裡沒有符號，是靠呼叫者認出來的：GammaToLinear 與'
            '指數退避策略都經過它，兩者都只可能是 pow。認法寫在 powThunk 欄位裡，'
            '哪天它們不再呼叫同一個位址，這支工具就會停下來。',
            'Hayst 與 Kratos 的 GetSpawnChance 用同一個模板，但各自多一個 op_Addition，'
            '而且綁在本專案未實作的流派上，因此不在本文件範圍內。',
            'MonsterModel.NewMonster 的那個分支只證明「類別被換成 Chesterson」。'
            '換了類別之後金幣怎麼算，是 GetMonsterGoldDrop 走 GetChestersonMultiplier 的事，'
            '兩者分別記錄，中間沒有第三段被省略。',
            'Try10xGold 也檢查同一個效果（十倍金幣在寶箱關內另有規則），'
            '但 Goldx10Chance 在本專案沒有任何來源，因此不在範圍內。',
            'StageEffectLength 的推入端有一個 int.MaxValue 的防護分支，兩次呼叫同一個 getter；'
            '等價於推入 StageEffectLength 一次。',
            '虛擬呼叫的目標是 vtable 槽，指令本身無法具名，所以記的是槽位移。'
            '0x1b8 是 MaxStackCount——CanSpawnTitan 與 IsAtMaxStacks 都只比對這一個槽，'
            '而 dump.cs 說這兩個方法比的就是 NumOfStacks 與 MaxStackCount；'
            '0x1c8 是相鄰的下一個槽 StageEffectLength，與 dump.cs 的宣告順序一致。',
            'GetMonsterCountPerStage 的契約減免（BonusType 44）同樣屬於未實作的系統，'
            '形狀記在 trace 裡但不實作。',
        ],
    }
    out = ROOT/'reference/tt2/8.2.0/special-titan-evidence.json'
    out.write_bytes((json.dumps(document, ensure_ascii=False, indent=2)+'\n').encode('utf-8'))
    print(f'wrote {out.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
