"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

The pet has three QTEs hanging off QTEController. This pins what each one actually does, and -
just as importantly - which two of them cannot be built here and why.

  * Lightning Burst (PetAttack, QTEType 1) IS buildable. Mash a number of taps and the pet lands
    one big hit: GetQTEBigAttack is the ordinary attack times PetAttackQTEDamage, nothing else.
    That hit carries DamageType.PetBurst, which has its own stage-skip arm and - this is the part
    that is easy to get wrong - NO titan-skip arm at all.
  * Flash Zip (PetBoss, QTEType 3) is NOT buildable. ApplyChargedBonus refuses to do anything
    unless PetBossQTEDuration is greater than zero, and nothing in this package's bonus tables
    grants it. Building it would produce a bonus that can never fire.
  * Heart of Gold (PetGold, QTEType 2) is deferred, not blocked: GetPetHomGold needs two gold
    formulas this project has not built yet (GetAverageBossGoldDrop, GetStageScaleGoldAmount).

The tap count is not a constant either - it is max(1, mashQTENumTaps - PetTapCountToAttack),
recomputed whenever that bonus changes, and the [ServerVar] it starts from (30) is a different
number from the one the ordinary pet charge uses.

The two skip arms are not transcribed: GetTitanSkip and GetStageSkip are abstractly executed for
DamageType.PetBurst and whatever they land on is what gets recorded.
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
MODIFY_BONUS = 0x27152AC
TO_FLOAT = 0x21E0F08
TO_INT = 0x21E0BD4

METHODS = {
    'bigAttack': (0x2391E40, 'PetModel$$GetQTEBigAttack'),
    'normalAttack': (0x2390488, 'PetModel$$GetNormalAttack'),
    'tapCount': (0x2395BD0, 'PetController$$BonusUpdatedHandler'),
    'mashTap': (0x2396324, 'PetController$$MashQTETapHandler'),
    'chargedBonus': (0x2394F7C, 'PetController$$ApplyChargedBonus'),
    'petReady': (0x2396D68, 'PetController$$OnQTEReady'),
    'homGold': (0x239ED20, 'PetModel$$GetPetHomGold'),
    'titanSkip': (0x2544194, 'StageLogic$$GetTitanSkip'),
    'stageSkip': (0x25448E4, 'StageLogic$$GetStageSkip'),
}

BONUS_IDS = {'PetAttackQTEDamage': 359, 'PetTapCountToAttack': 372, 'PetBossQTEDuration': 357,
             'PetBossQTEDamage': 358, 'PetDamage': 352, 'PetQTEStageSkip': 371,
             'PetAttackStageSkip': 362, 'PetAttackTitanSkip': 363, 'StageSkip': 443, 'TitanSkip': 472, 'TitanSkipMult': 473,
             'DeadlyDamagePet': 171, 'PetGoldQTEAmount': 366, 'HandOfMidasSkillAmount': 255,
             'PetAutoAttackEnabledOverride': 350, 'PetQTEDamage': 370}

# PetController instance fields, straight out of dump.cs.
FIELDS = {0x50: ('mashQTENumTaps', 'int'), 0x54: ('currentTapCount', 'int'),
          0x58: ('currentQTETapCount', 'int'), 0x5C: ('mashQTEburstReady', 'bool'),
          0x5D: ('mashQTEbursting', 'bool'), 0x5E: ('bossQTEburstReady', 'bool'),
          0x5F: ('bossQTEbursting', 'bool'), 0x60: ('goldQTEOn', 'bool')}

STATICS = {0xAF0: ('mashQTENumTaps', 'int')}

DAMAGE_TYPES = {'Pet': 9, 'PetCrit': 10, 'PetBurst': 11, 'PetBurstCrit': 12}
PET_QTE_TYPES = {'PetAttack': 1, 'PetGold': 2, 'PetBoss': 3}

NOISE = {'get_instance'}


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

    def body(address, cap=0x1600):
        following = next((a for a in starts if a > address), address+cap)
        return read(address, min(following-address, cap))

    def fact(address):
        return {'name': symbols[address], 'rva': hex(address), 'bytesSha256': sha(body(address))}

    for key, (address, name) in METHODS.items():
        if symbols.get(address) != name:
            raise ValueError(f'{key}: expected {name} at {address:#x}, found {symbols.get(address)!r}')

    enum = json.loads((ROOT/'reference/tt2/8.2.0/native-bonus-types.json').read_text(encoding='utf-8'))
    for name, wanted in BONUS_IDS.items():
        if int(enum['values'][name]) != wanted:
            raise ValueError(f'{name} is {enum["values"][name]}, not {wanted}')
    by_id = {value: name for name, value in BONUS_IDS.items()}

    declared = dict(re.findall(r'public const DamageType (\w+) = (\d+);', dump))
    for name, value in DAMAGE_TYPES.items():
        if int(declared.get(name, -1)) != value:
            raise ValueError(f'DamageType.{name} is {declared.get(name)}, not {value}')
    pet = re.search(r'^public class PetController(?=[\s:])[^\n]*\n\{(.*?)^\t// (?:Properties|Methods)',
                    dump, re.S | re.M)
    for offset, (field, kind) in FIELDS.items():
        if not re.search(r'private '+kind+' '+field+r'; // 0x'+f'{offset:X}'+r'\b', pet.group(1)):
            raise ValueError(f'PetController.{field} is no longer a {kind} at {offset:#x}')
    block = re.search(r'^public class ServerVarsModel(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)
    for offset, (field, kind) in STATICS.items():
        if not re.search(r'public static '+kind+' '+field+r'; // 0x'+f'{offset:X}'+r'\b', block):
            raise ValueError(f'{field} is no longer a {kind} at {offset:#x}')

    instructions = {}
    for address, _ in METHODS.values():
        for ins in machine.disasm(body(address), address):
            instructions[ins.address] = ins

    def bonus_at(address, floor):
        """The BonusType a call is given, found by walking back from the call."""
        at = address-4
        while at >= floor:
            ins = instructions.get(at)
            if ins is None or ins.mnemonic == 'bl':
                return None
            if re.match(r'w1(,|$)', ins.op_str):
                m = re.fullmatch(r'w1, #(0x[0-9a-f]+|\d+)', ins.op_str)
                return int(m.group(1), 0) if m else None
            at -= 4
        return None

    def trace(address):
        events = []
        for ins in machine.disasm(body(address), address):
            if ins.mnemonic in ('ldr', 'str', 'ldrb', 'strb'):
                m = re.fullmatch(r'[swq]\d+, \[x\d+, #(0x[0-9a-f]+)\]', ins.op_str)
                if m and int(m.group(1), 16) in STATICS:
                    events.append(('static', STATICS[int(m.group(1), 16)][0], hex(ins.address)))
                elif m and int(m.group(1), 16) in FIELDS and ins.mnemonic in ('ldr', 'ldrb'):
                    events.append(('field', FIELDS[int(m.group(1), 16)][0], hex(ins.address)))
            elif ins.mnemonic in ('cmp', 'csinc', 'sub', 'scvtf', 'fdiv'):
                # `sub sp, sp, #imm` is the prologue, not arithmetic.
                if ins.op_str.startswith(('w', 's')) and not ins.op_str.startswith('sp,'):
                    events.append((ins.mnemonic, ins.op_str, hex(ins.address)))
            elif ins.mnemonic == 'bl' and ins.op_str.startswith('#'):
                target = int(ins.op_str.lstrip('#'), 16)
                name = symbols.get(target, '')
                short = name.split('$$')[-1]
                if target in (GET_BONUS, MODIFY_BONUS):
                    got = bonus_at(ins.address, address)
                    label = by_id.get(got, 'via register' if got is None else f'BonusType#{got}')
                    events.append(('ModifyBonus' if target == MODIFY_BONUS else 'GetBonus',
                                   label, hex(ins.address)))
                elif target == TO_FLOAT:
                    events.append(('call', 'op_Explicit->float', hex(ins.address)))
                elif target == TO_INT:
                    events.append(('call', 'op_Explicit->int', hex(ins.address)))
                elif name and short not in NOISE:
                    events.append(('call', short, hex(ins.address)))
            elif ins.mnemonic == 'b' and ins.op_str.startswith('#'):
                target = int(ins.op_str.lstrip('#'), 16)
                if target in symbols:
                    events.append(('call', symbols[target].split('$$')[-1], hex(ins.address)))
        return events

    traces = {key: trace(address) for key, (address, _) in METHODS.items()}

    def kinds(key, keep=None):
        return [(a, b) for a, b, _ in traces[key] if keep is None or a in keep]

    def want(key, expected, keep=None):
        got = kinds(key, keep)
        if got != expected:
            raise ValueError(f'{key} changed shape:\n  got      {got}\n  expected {expected}')

    # --- Lightning Burst: the big hit is the ordinary hit times one bonus ---
    want('bigAttack', [('call', 'GetNormalAttack'), ('GetBonus', 'PetAttackQTEDamage'),
                       ('call', 'op_Multiply')],
         keep={'call', 'GetBonus'})
    # ...and the ordinary hit only picks up the deadly-strike pair while that skill is running.
    want('normalAttack', [('call', 'op_Multiply'), ('call', 'IsSkillActive'),
                          ('call', 'GetAverageDeadlyStrike'), ('GetBonus', 'DeadlyDamagePet'),
                          ('call', 'op_Multiply'), ('call', 'op_Multiply')],
         keep={'call', 'GetBonus'})

    # --- how many taps ---
    # The new value arrives as the handler's own argument, so there is no GetBonus here.
    want('tapCount', [('cmp', 'w21, #0x15e'), ('cmp', 'w21, #0x174'), ('static', 'mashQTENumTaps'),
                      ('call', 'op_Explicit->int'), ('sub', 'w8, w20, w0'), ('cmp', 'w8, #1'),
                      ('csinc', 'w8, w8, wzr, gt'), ('call', 'CheckAndEnableAutoAttack')],
         keep={'GetBonus', 'static', 'call', 'sub', 'cmp', 'csinc'})
    # The handler is a switch on the bonus that changed; the tap count arm is the second one.
    arms = [b for a, b, _ in traces['tapCount'] if a == 'cmp' and re.fullmatch(r'w21, #0x[0-9a-f]+', b)]
    if [int(a.split('#')[1], 16) for a in arms] != [BONUS_IDS['PetAutoAttackEnabledOverride'],
                                                    BONUS_IDS['PetTapCountToAttack']]:
        raise ValueError(f'BonusUpdatedHandler no longer switches on those two bonuses: {arms}')

    # --- the mash itself: compare the running count against the target ---
    mash = kinds('mashTap', {'field', 'cmp', 'call'})
    if mash[:3] != [('field', 'currentQTETapCount'), ('field', 'mashQTENumTaps'), ('cmp', 'w8, w9')]:
        raise ValueError(f'MashQTETapHandler changed shape: {mash[:6]}')
    if ('field', 'mashQTEburstReady') not in mash:
        raise ValueError('MashQTETapHandler no longer checks mashQTEburstReady')
    for wanted in ('GetQTEBigAttack', 'ApplyChargedBonus', 'QueueMonsterAttack', 'HandleQTEFinished'):
        if not any(b == wanted for a, b, _ in traces['mashTap'] if a == 'call'):
            raise ValueError(f'MashQTETapHandler no longer calls {wanted}')

    # --- Flash Zip: the gate that makes it unbuildable here ---
    charged = kinds('chargedBonus', {'GetBonus', 'ModifyBonus', 'call'})
    if charged[:4] != [('GetBonus', 'PetBossQTEDuration'), ('call', 'op_Implicit'),
                       ('call', 'op_GreaterThan'), ('GetBonus', 'PetBossQTEDamage')]:
        raise ValueError(f'ApplyChargedBonus changed shape: {charged}')
    if ('ModifyBonus', 'PetDamage') not in charged:
        raise ValueError('ApplyChargedBonus no longer folds the burst into PetDamage')
    # The duration is read a second time, to schedule the removal.
    if [b for a, b, _ in traces['chargedBonus'] if a == 'GetBonus'].count('PetBossQTEDuration') != 2:
        raise ValueError('PetBossQTEDuration is no longer read twice (gate, then removal timer)')

    # --- Heart of Gold: the two gold formulas it needs first ---
    gold = kinds('homGold', {'call', 'GetBonus'})
    for wanted in ('GetAverageBossGoldDrop', 'GetStageScaleGoldAmount'):
        if ('call', wanted) not in gold:
            raise ValueError(f'GetPetHomGold no longer needs {wanted}')
    if ('GetBonus', 'PetGoldQTEAmount') not in gold:
        raise ValueError('GetPetHomGold no longer reads PetGoldQTEAmount')

    # --- which pet QTEs OnQTEReady even handles ---
    ready_arms = sorted(int(b.split('#')[1], 0) for a, b, _ in traces['petReady']
                        if a == 'cmp' and re.fullmatch(r'w20, #\d+', b))
    if ready_arms != [PET_QTE_TYPES['PetAttack'], PET_QTE_TYPES['PetGold']]:
        raise ValueError(f'PetController.OnQTEReady arms changed: {ready_arms}')

    # --- the two skip arms, executed rather than transcribed ---
    def land(key, register, value):
        """Run a DamageType switch with `register` = value and report which arm it reaches.

        The dispatch is interleaved with loads (the result slot is seeded from GHDouble.Zero
        before the compares), so the walk stops at the first CALL instead: every arm opens by
        fetching the bonus singleton, and the dispatch itself contains no calls.
        """
        address = METHODS[key][0]
        start = next(a for a in sorted(instructions) if a >= address
                     and instructions[a].mnemonic == 'cmp'
                     and re.fullmatch(register+r', #(0x[0-9a-f]+|\d+)', instructions[a].op_str))
        signed = lambda n: n-0x100000000 if n >= 0x80000000 else n
        regs, flags, at = {register: value & 0xFFFFFFFF}, None, start
        for _ in range(96):
            ins = instructions[at]
            if ins.mnemonic == 'bl':
                return at
            if ins.mnemonic == 'cmp' and (m := re.fullmatch(r'(w\d+), #(0x[0-9a-f]+|\d+)', ins.op_str)):
                flags = (regs[m.group(1)], int(m.group(2), 0))
            elif ins.mnemonic == 'sub' and (
                    s := re.fullmatch(r'(w\d+), (w\d+), #(0x[0-9a-f]+|\d+)', ins.op_str)):
                # capstone prints these immediates in either base; only taking decimal silently
                # left the register unset and made whole arms unreachable.
                regs[s.group(1)] = (regs[s.group(2)]-int(s.group(3), 0)) & 0xFFFFFFFF
            elif ins.mnemonic == 'b' and ins.op_str.startswith('#'):
                at = int(ins.op_str.lstrip('#'), 16)
                continue
            elif ins.mnemonic.startswith('b.'):
                left, right = flags
                taken = {'gt': signed(left) > signed(right), 'eq': left == right,
                         'ne': left != right, 'hs': left >= right, 'lo': left < right,
                         'hi': left > right, 'ls': left <= right,
                         'lt': signed(left) < signed(right)}[ins.mnemonic[2:]]
                if taken:
                    at = int(ins.op_str.lstrip('#'), 16)
                    continue
            at += ins.size
        raise ValueError(f'{key} dispatch did not settle for DamageType {value}')

    def bonuses_from(key, start, limit):
        """The first few bonuses read once execution reaches `start`."""
        return [b for a, b, at in traces[key] if a == 'GetBonus' and int(at, 16) >= start][:limit]

    all_types = {name: int(value) for name, value in
                 re.findall(r'public const DamageType (\w+) = (\d+);', dump)}
    # GetTitanSkip dispatches with a compare chain, so it can be walked. GetStageSkip uses a jump
    # table (`cmp #0x28` then an indirect `br`), which this walk cannot follow - its pairing comes
    # from skip-evidence.json instead, which reads the stats panel's (BonusType, DamageType)
    # literals. Recorded as a limit rather than guessed at.
    titan_lands = {n: land('titanSkip', 'w19', v) for n, v in all_types.items()}

    # PetBurst lands where other arm-less types land: that IS the default, and the only bonus
    # left on that path is the multiplier - the result it multiplies was seeded to GHDouble.Zero.
    for peer in ('PetZip', 'Splash'):
        if titan_lands['PetBurst'] != titan_lands[peer]:
            raise ValueError(f'PetBurst no longer shares the default landing with {peer}')
    burst_titan = bonuses_from('titanSkip', titan_lands['PetBurst'], 2)
    if burst_titan != ['TitanSkipMult']:
        raise ValueError(f'the titan-skip default path changed: {burst_titan}')
    # Without a control this proves nothing, so check a type that DOES have an arm.
    control = bonuses_from('titanSkip', titan_lands['Pet'], 2)
    if control != ['TitanSkip', 'PetAttackTitanSkip']:
        raise ValueError(f'the control arm (DamageType.Pet) changed: {control}')
    if titan_lands['Pet'] == titan_lands['PetBurst']:
        raise ValueError('the control arm now shares the default landing; the walk is broken')

    # The stage-skip side comes from the already-pinned pairing table.
    skip = json.loads((ROOT/'reference/tt2/8.2.0/skip-evidence.json').read_text(encoding='utf-8'))
    stage_pair = next((s for s in skip['rules']['stageSkip']['sources']
                       if s['bonus'] == 'PetQTEStageSkip'), None)
    if stage_pair is None or stage_pair['damageType'] != 'PetBurst':
        raise ValueError(f'PetQTEStageSkip is no longer paired with PetBurst: {stage_pair}')
    if stage_pair['damageTypeId'] != DAMAGE_TYPES['PetBurst']:
        raise ValueError('the PetBurst DamageType id disagrees with skip-evidence.json')
    if any(s['bonus'] == 'PetQTEStageSkip' for s in skip['rules']['titanSkip']['sources']):
        raise ValueError('PetQTEStageSkip now appears on the titan-skip side too')
    burst_stage = ['StageSkip', stage_pair['bonus']]

    servervars = json.loads((ROOT/'reference/tt2/8.2.0/servervar-defaults.json')
                            .read_text(encoding='utf-8'))['recovered']
    statics = {}
    for field, _ in STATICS.values():
        if field not in servervars:
            raise ValueError(f'{field} has no recovered default')
        statics[field] = servervars[field]['value']

    coverage = json.loads((ROOT/'docs/bonus-coverage.json').read_text(encoding='utf-8'))
    rows = {r['id']: r for r in coverage['rows']}
    # The two "cannot build" claims are about this project's sources, so check them against the
    # coverage table rather than asserting them in prose.
    if rows['PetBossQTEDuration']['sources']:
        raise ValueError('PetBossQTEDuration now has a source; Flash Zip may be buildable')
    if rows['PetQTEDamage']['nativeReaders']:
        raise ValueError('PetQTEDamage now has a native reader')
    if not rows['PetAttackQTEDamage']['sources']:
        raise ValueError('PetAttackQTEDamage lost its source; Lightning Burst would do nothing')
    if not rows['PetQTEStageSkip']['sources']:
        raise ValueError('PetQTEStageSkip lost its source')

    taps = statics['mashQTENumTaps']
    document = {
        'version': '8.2.0',
        'role': '寵物的三種 QTE：雷霆爆發可以做、閃現做了也不會生效、米達斯之心缺兩個金幣前置。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': '雷霆爆發（PetAttack，QTEType 1）的傷害是 '
                   'PetModel.GetQTEBigAttack＝GetNormalAttack(true) × Bonus(PetAttackQTEDamage)，'
                   '沒有別的因子；GetNormalAttack 只在致命一擊執行中時多乘 '
                   'GetAverageDeadlyStrike × Bonus(DeadlyDamagePet)。'
                   f'要連打幾下由 PetController.BonusUpdatedHandler 維護：'
                   f'max(1, mashQTENumTaps({taps}) − Bonus(PetTapCountToAttack))，'
                   'MashQTETapHandler 每次點擊比對 currentQTETapCount 與 mashQTENumTaps，'
                   '到了才 ApplyChargedBonus、GetQTEBigAttack、QueueMonsterAttack 與 HandleQTEFinished。'
                   '那一擊帶的是 DamageType.PetBurst（11），'
                   '**GetStageSkip 對它有一支（StageSkip ＋ PetQTEStageSkip），'
                   'GetTitanSkip 完全沒有那一支**——它落在 default，'
                   '而 default 路上的結果槽在方法開頭就被清成 0，所以雷霆爆發一隻泰坦都不跳。'
                   '閃現（PetBoss，QTEType 3）走 ApplyChargedBonus：'
                   '它先讀 Bonus(PetBossQTEDuration) 與 0 比大小，**不大於 0 就直接返回**；'
                   '過了才把 Bonus(PetBossQTEDamage) 經 ModifyBonus 疊到 PetDamage 上，'
                   '並在 duration 秒後移除。'
                   '米達斯之心（PetGold，QTEType 2）走 PetModel.GetPetHomGold，'
                   '它以 GetAverageBossGoldDrop 起算，再乘 Pow(GetStageScaleGoldAmount, 指數)、'
                   'Bonus(PetGoldQTEAmount) 與 petHomGoldMult，'
                   '點石成金開著時還要再乘 Pow(HandOfMidasSkillAmount, petMidasBonusExpo)。',
        'consequence': '本專案接上雷霆爆發：學了天賦「雷霆爆發」之後，QTE 冷卻結束時寵物進入連打狀態，'
                       f'打滿 max(1, {taps} − PetTapCountToAttack) 下就放一次 '
                       'PetAttackQTEDamage 倍的大攻擊，那一擊照原生吃跳關、不吃跳泰坦。'
                       '閃現與米達斯之心**刻意不做**，理由分別記在 blocked 與 deferred。',
        'methods': {key: fact(address) for key, (address, _) in METHODS.items()},
        'damageTypes': DAMAGE_TYPES,
        'petQTETypes': PET_QTE_TYPES,
        'fields': {field: {'offset': hex(offset), 'type': kind}
                   for offset, (field, kind) in FIELDS.items()},
        'formulas': {
            'burstDamage': 'GetNormalAttack(true) × Bonus(PetAttackQTEDamage)',
            'normalAttack': '寵物攻擊；致命一擊執行中時再乘 '
                            'GetAverageDeadlyStrike × Bonus(DeadlyDamagePet)',
            'mashTaps': f'max(1, mashQTENumTaps({taps}) − Bonus(PetTapCountToAttack))',
            'burstTitanSkip': '沒有這一支：DamageType.PetBurst 落在 GetTitanSkip 的 default，回 0',
            'burstStageSkip': '(Bonus(StageSkip) + Bonus(PetQTEStageSkip)) × 倍率，取整數',
            'flashZipGate': 'Bonus(PetBossQTEDuration) > 0 才套用，否則整個方法直接返回',
            'heartOfGold': 'GetAverageBossGoldDrop × Pow(GetStageScaleGoldAmount, petGoldStageScaleExpo)'
                           ' × Bonus(PetGoldQTEAmount) × petHomGoldMult'
                           '（點石成金開著時再乘 Pow(HandOfMidasSkillAmount, petMidasBonusExpo)）',
        },
        'skipArms': {
            'titanSkip': {'petBurstLandsAt': hex(titan_lands['PetBurst']),
                          'petBurstBonuses': burst_titan,
                          'sharedWithArmlessTypes': {n: hex(titan_lands[n]) for n in ('PetZip', 'Splash')},
                          'controlArmPet': control},
            'stageSkip': {'source': 'skip-evidence.json 的配對表（GetStageSkip 走跳表，無法逐步走）',
                          'petBurstBonuses': burst_stage},
        },
        'blocked': {
            'PetBoss': '閃現（QTEType 3）在本專案做了也不會生效。'
                       'ApplyChargedBonus 的第一件事就是拿 Bonus(PetBossQTEDuration) 與 0 比大小，'
                       '不大於 0 就返回，連 PetBossQTEDamage 都不會被套用。'
                       '那個加成是加法型的秒數（中性值 0），而本專案匯入的加成資料表裡'
                       '**沒有任何天賦、神器、套裝或寵物給它**，所以閘門永遠關著。'
                       '天賦「閃現」給的是 PetBossQTEDamage 與 PetQTECooldownMult，不是 duration。',
        },
        'deferred': {
            'PetGold': '米達斯之心（QTEType 2）不是做不了，是缺前置：'
                       'GetPetHomGold 需要 MonsterModel.GetAverageBossGoldDrop 與 '
                       'PlayerModel.GetStageScaleGoldAmount，這兩條金幣公式本專案都還沒還原。'
                       'GetStageScaleGoldAmount 同時也是妖精金幣缺的四項之一，'
                       '做掉它會一併改動妖精的金幣數額，屬於獨立的一段工作。',
        },
        'traces': traces,
        'statics': {field: {'offset': hex(offset), 'value': statics[field]}
                    for offset, (field, _) in STATICS.items()},
        'bonusIds': BONUS_IDS,
        'limits': [
            f'連打次數的 mashQTENumTaps（{taps}）與本專案平常寵物攻擊的蓄力次數（20）'
            '是**兩個不同的數字**：前者是 [ServerVar]，後者是本專案沿用 7.5 的值。不要互相套用。',
            '原生的 OnQTEReady 對雷霆爆發還有兩個表現層條件（寵物目前的 PetState，'
            '以及這隻怪是不是在 petMashQTEStartOfBattleSeconds 秒內剛生成）。'
            '本專案沒有場上的寵物實體與 PetState，所以只要求「有出戰中的傷害寵物」，'
            '其餘照 QTE 排程走。',
            '原生的連打是寵物身上獨立的按鈕，本專案沒有場上實體，'
            '所以把連打併進戰鬥區的點擊——同一下點擊既打泰坦也算進連打。',
            '原生另有 DamageType.PetBurstCrit（12）的暴擊版本，'
            '本專案的寵物攻擊沒有暴擊分支，所以只用 PetBurst（11）。',
            'PetQTEDamage（370）在整個映像沒有取值點，套裝給了它也沒有用，因此沒有接。',
            'PetAttackQTESplashCount 既沒有來源也沒有取值點，2.14.0 的濺射調查已經確認過。',
            '連打次數的下限 1 **現在驗不出來**：PetTapCountToAttack 唯一的來源是天賦「寵物傷害」，'
            '滿級只減 15，碰不到 30，所以 max(1, …) 那一步永遠不會作用。'
            '這是這份資料下無法區分，不是測試的漏洞；照原生保留下限，'
            'tests/pet-qte.test.mjs 把前提釘住，哪天有來源推得過去就會先轉紅。',
        ],
    }
    out = ROOT/'reference/tt2/8.2.0/pet-qte-evidence.json'
    out.write_bytes((json.dumps(document, ensure_ascii=False, indent=2)+'\n').encode('utf-8'))
    print(f'wrote {out.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
