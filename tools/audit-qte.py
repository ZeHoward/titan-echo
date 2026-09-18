"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

QTEController is what decides when a fairy turns up, when the pet flashes to the boss, and when
every other "tap me now" prompt appears. All nine of them share one schedule: a cooldown timer,
then a ready event, then an expire timer that puts the cooldown back if nobody tapped.

GetCooldownDuration is the whole of it. The shape is the same for every type -

    (cooldownTime - Bonus(CooldownBonusType)) x (1 + randomness x Random.Range(-1, 1))

- and then a switch on the QTE type multiplies a few more bonuses in. The table supplies
cooldownTime, randomness and which bonus does the subtracting; the switch is compiled in.

Two things are easy to get wrong and are pinned instruction by instruction:

  * the cooldown bonus SUBTRACTS SECONDS, it does not scale. FairyCooldown's own table entry says
    additive/subtract/seconds, and the native code agrees: fsub, not fmul.
  * a type with no entry in the table returns 0 WITHOUT the minimum being applied. The clamp sits
    after the switch, on the path the table hit takes; the miss branches straight past it.

The per-type switch is not hand-copied here. The dispatch block is abstractly executed for every
QTEType value, and whichever bonuses live in the block it lands on are what get recorded.
"""
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
COOLDOWN = 0x241066C
METHODS = {
    'cooldown': (COOLDOWN, 'QTEController$$GetCooldownDuration'),
    'expiration': (0x2410CC4, 'QTEController$$GetExpirationDuration'),
    'active': (0x2410D80, 'QTEController$$GetActiveDuration'),
    'scheduleCooldown': (0x240FEB8, 'QTEController$$ScheduleCooldown'),
    'scheduleExpire': (0x24102E4, 'QTEController$$ScheduleExpire'),
    'cooldownFinished': (0x2410244, 'QTEController$$HandleQTECooldownFinished'),
    'unlocked': (0x240FDE0, 'QTEModel$$IsQTEUnlocked'),
    'bonusType': (0x2410BA0, 'QTEModel$$GetCooldownBonusType'),
    'staticInit': (0x2411008, 'QTEController$$.cctor'),
}

# Where the switch starts, and the tail every arm falls into. Both are re-derived below: the
# dispatch is executed for each type, so a moved arm shows up as a changed landing address.
DISPATCH = 0x2410810
TAIL = 0x2410B50

# GHDouble -> primitive. Two overloads, and the switch uses both: UltraDaggerCount is read as an int.
TO_FLOAT = 0x21E0F08
TO_INT = 0x21E0BD4

# QTEInfo instance fields, straight out of dump.cs.
FIELDS = {0x14: 'TalentId', 0x18: 'CooldownBonusType', 0x1C: 'cooldownTime',
          0x20: 'expireTime', 0x24: 'activeTime', 0x28: 'randomness'}
FIELD_TYPES = {'TalentId': 'TalentID', 'CooldownBonusType': 'BonusType', 'cooldownTime': 'float',
               'expireTime': 'float', 'activeTime': 'float', 'randomness': 'float'}

STATICS = {0x774: ('daggerCooldownAutoThrowMult', 'float')}

BONUS_IDS = {'PetQTECooldownMult': 369, 'CompanionQTECooldownMult': 121,
             'PetGoldQTECooldownMult': 365, 'StreamOfBladesCooldownReduction': 436,
             'UltraDaggerCooldownMult': 508, 'UltraDaggerCount': 509,
             'FairyCooldown': 199, 'PetAttackQTECooldown': 360, 'PetGoldQTECooldown': 364,
             'PetBossQTECooldown': 356, 'ClanQTECooldown': 105, 'HelperQTECooldown': 277,
             'ForbiddenContractQTECooldown': 206, 'UltraDaggerCooldown': 507}

QTE_TYPES = {'None': 0, 'PetAttack': 1, 'PetGold': 2, 'PetBoss': 3, 'ClanShip': 4,
             'Helper': 5, 'Fairy': 6, 'UltraDagger': 7, 'ForbiddenContract': 8,
             'RoyalContract': 9, 'Goblin': -1}
QTE_STATES = {'Locked': 0, 'CoolDown': 1, 'Active': 2}

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

    def body(address, cap=0x1000):
        following = next((a for a in starts if a > address), address+cap)
        return read(address, min(following-address, cap))

    def fact(address):
        return {'name': symbols[address], 'rva': hex(address), 'bytesSha256': sha(body(address))}

    for key, (address, name) in METHODS.items():
        if symbols.get(address) != name:
            raise ValueError(f'{key}: expected {name} at {address:#x}, found {symbols.get(address)!r}')
    for address, name in ((TO_FLOAT, 'float'), (TO_INT, 'int')):
        if not re.search(r'// RVA: '+f'0x{address:X}'+r' [^\n]*\n\tpublic static '+name
                         + r' op_Explicit\(GHDouble value\)', dump):
            raise ValueError(f'{address:#x} is no longer GHDouble -> {name}')

    enum = json.loads((ROOT/'reference/tt2/8.2.0/native-bonus-types.json').read_text(encoding='utf-8'))
    for name, wanted in BONUS_IDS.items():
        if int(enum['values'][name]) != wanted:
            raise ValueError(f'{name} is {enum["values"][name]}, not {wanted}')
    by_id = {value: name for name, value in BONUS_IDS.items()}

    # The two enums and the field layout come from dump.cs, so a rename or a reorder fails here
    # rather than quietly shifting which branch a type takes.
    for enum_name, members in (('QTEType', QTE_TYPES), ('QTEState', QTE_STATES)):
        block = re.search(r'^public enum '+enum_name+r'(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M)
        if block is None:
            raise ValueError(f'{enum_name} is gone')
        declared = dict(re.findall(r'public const '+enum_name+r' (\w+) = (-?\d+);', block.group(1)))
        if {k: int(v) for k, v in declared.items()} != members:
            raise ValueError(f'{enum_name} changed: {declared}')
    info = re.search(r'^public class QTEInfo(?=[\s:])[^\n]*\n\{(.*?)^\t// Properties', dump, re.S | re.M)
    if info is None:
        raise ValueError('QTEInfo is gone')
    for offset, field in FIELDS.items():
        kind = FIELD_TYPES[field]
        pattern = (r'(?:private '+kind+r' <'+field+r'>k__BackingField|public '+kind+r' '+field
                   + r');\s*// 0x'+f'{offset:X}'+r'\b')
        if not re.search(pattern, info.group(1)):
            raise ValueError(f'QTEInfo.{field} is no longer a {kind} at {offset:#x}')
    # MinCooldown is a column in the shipped table with no field to land in - recorded as a limit.
    if re.search(r'\bminCooldown\b', info.group(1), re.I):
        raise ValueError('QTEInfo now has a minCooldown field; the limit below is stale')

    block = re.search(r'^public class ServerVarsModel(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)
    for offset, (field, kind) in STATICS.items():
        if not re.search(r'public static '+kind+' '+field+r'; // 0x'+f'{offset:X}'+r'\b', block):
            raise ValueError(f'{field} is no longer a {kind} at {offset:#x}')

    instructions = {ins.address: ins for ins in machine.disasm(body(COOLDOWN), COOLDOWN)}

    def bonus_at(address):
        """The BonusType a GetBonus call is given, found by walking back from the call."""
        at = address-4
        while at >= COOLDOWN:
            ins = instructions[at]
            if ins.mnemonic == 'bl':
                return None  # another call in the way; nothing can be claimed
            if re.match(r'w1(,|$)', ins.op_str) and ins.mnemonic in ('mov', 'movz', 'orr', 'add', 'ldr'):
                m = re.fullmatch(r'w1, #(0x[0-9a-f]+|\d+)', ins.op_str)
                return int(m.group(1), 0) if m else None
            at -= 4
        return None

    def trace(address):
        events = []
        for ins in machine.disasm(body(address), address):
            if ins.mnemonic == 'ldr':
                m = re.fullmatch(r'[sw]\d+, \[x\d+, #(0x[0-9a-f]+)\]', ins.op_str)
                if m and int(m.group(1), 16) in FIELDS:
                    events.append(('field', FIELDS[int(m.group(1), 16)], hex(ins.address)))
                elif m and int(m.group(1), 16) in STATICS:
                    events.append(('static', STATICS[int(m.group(1), 16)][0], hex(ins.address)))
                elif re.fullmatch(r's\d+, \[x\d+\]', ins.op_str):
                    events.append(('static', 'MIN_COOLDOWN_SECONDS', hex(ins.address)))
            elif ins.mnemonic == 'fmov' and '#' in ins.op_str:
                events.append(('fmov', ins.op_str, hex(ins.address)))
            elif ins.mnemonic in ('fmul', 'fadd', 'fsub', 'fcmp', 'fcsel', 'cmp', 'ccmp', 'cset',
                                  'sub', 'orr', 'csel'):
                if ins.op_str.startswith(('s', 'w', 'd')):
                    events.append((ins.mnemonic, ins.op_str, hex(ins.address)))
            elif ins.mnemonic.startswith('b.') or ins.mnemonic in ('b', 'tbz', 'tbnz'):
                # A tail call is still a call: `b #addr` onto another method's entry point.
                target = int(ins.op_str.lstrip('#'), 16) if ins.op_str.startswith('#') else None
                if ins.mnemonic == 'b' and target in symbols:
                    events.append(('call', symbols[target].split('$$')[-1], hex(ins.address)))
                else:
                    events.append((ins.mnemonic, ins.op_str, hex(ins.address)))
            elif ins.mnemonic == 'bl' and ins.op_str.startswith('#'):
                target = int(ins.op_str.lstrip('#'), 16)
                name = symbols.get(target, '')
                short = name.split('$$')[-1]
                if target == GET_BONUS:
                    got = bonus_at(ins.address)
                    events.append(('GetBonus', by_id.get(got, 'via GetCooldownBonusType'
                                                         if got is None else f'BonusType#{got}'),
                                   hex(ins.address)))
                elif target == TO_FLOAT:
                    events.append(('call', 'op_Explicit->float', hex(ins.address)))
                elif target == TO_INT:
                    events.append(('call', 'op_Explicit->int', hex(ins.address)))
                elif name and short not in NOISE:
                    events.append(('call', short, hex(ins.address)))
        return events

    traces = {key: trace(address) for key, (address, _) in METHODS.items()}

    def kinds(key, keep=None):
        return [(a, b) for a, b, _ in traces[key] if keep is None or a in keep]

    def want(key, expected, keep=None):
        got = kinds(key, keep)
        if got != expected:
            raise ValueError(f'{key} changed shape:\n  got      {got}\n  expected {expected}')

    # --- the shared base: look the type up, subtract the bonus, apply the randomness ---
    # Everything up to the switch. fsub is the whole point: the bonus is seconds off the clock.
    # The arithmetic is interleaved with the first compare, so the head ends at the first branch
    # taken, not at DISPATCH itself.
    first_branch = min(int(at, 16) for a, _, at in traces['cooldown'] if a.startswith('b.'))
    head = [(a, b) for a, b, at in traces['cooldown'] if int(at, 16) < first_branch
            and a in ('call', 'GetBonus', 'field', 'fmov', 'fmul', 'fsub', 'fadd')]
    if head != [('call', 'ContainsKey'), ('call', 'get_Item'), ('call', 'GetCooldownBonusType'),
                ('GetBonus', 'via GetCooldownBonusType'), ('call', 'op_Explicit->float'),
                ('fmov', 's0, #-1.00000000'), ('field', 'cooldownTime'),
                ('fmov', 's1, #1.00000000'), ('field', 'randomness'),
                ('fmov', 's11, #1.00000000'), ('call', 'Range'),
                ('fmul', 's0, s10, s0'), ('fsub', 's1, s9, s8'),
                ('fadd', 's0, s0, s11'), ('fmul', 's10, s1, s0')]:
        raise ValueError(f'the shared base changed shape:\n  {head}')

    # --- the switch, executed rather than transcribed ---
    def land(value):
        """Run the dispatch block with w19 = value and report which arm it reaches.

        The compares are interleaved with the tail of the shared base, so the walk steps over
        anything that is not a compare or a branch. Every arm opens with a load or an adrp and
        the dispatch itself contains neither, which is what makes that the stopping line.
        """
        signed = lambda n: n-0x100000000 if n >= 0x80000000 else n
        regs, flags, at = {'w19': value & 0xFFFFFFFF}, None, DISPATCH
        for _ in range(64):
            ins = instructions[at]
            if ins.mnemonic in ('ldr', 'adrp'):
                return at
            if ins.mnemonic == 'cmp' and (m := re.fullmatch(r'(w\d+), #(0x[0-9a-f]+|\d+)', ins.op_str)):
                flags = (regs[m.group(1)], int(m.group(2), 0))
            elif ins.mnemonic == 'sub' and (s := re.fullmatch(r'(w\d+), (w\d+), #(\d+)', ins.op_str)):
                regs[s.group(1)] = (regs[s.group(2)]-int(s.group(3))) & 0xFFFFFFFF
            elif ins.mnemonic == 'b' and ins.op_str.startswith('#'):
                at = int(ins.op_str.lstrip('#'), 16)
                continue
            elif ins.mnemonic.startswith('b.'):
                left, right = flags
                taken = {'gt': signed(left) > signed(right), 'eq': left == right,
                         'ne': left != right, 'hs': left >= right,
                         'lt': signed(left) < signed(right)}[ins.mnemonic[2:]]
                if taken:
                    at = int(ins.op_str.lstrip('#'), 16)
                    continue
            at += ins.size
        raise ValueError(f'dispatch did not settle for QTEType {value}')

    landings = {name: land(value) for name, value in QTE_TYPES.items() if value >= 0}
    edges = sorted({*landings.values(), TAIL})

    def bonuses_in(start):
        """The bonuses read in the arm that begins at `start`, up to the next arm or the tail."""
        stop = next((e for e in edges if e > start), TAIL)
        out = []
        for a, b, at in traces['cooldown']:
            if a == 'GetBonus' and start <= int(at, 16) < stop:
                out.append(b)
            if a == 'static' and b != 'MIN_COOLDOWN_SECONDS' and start <= int(at, 16) < stop:
                out.append(b)
        return out

    branches = {name: bonuses_in(landings[name]) for name in landings}
    expected = {
        'None': [], 'Fairy': [], 'ForbiddenContract': [], 'RoyalContract': [],
        'PetAttack': ['PetQTECooldownMult', 'CompanionQTECooldownMult'],
        'PetBoss': ['PetQTECooldownMult', 'CompanionQTECooldownMult'],
        'PetGold': ['PetQTECooldownMult', 'CompanionQTECooldownMult', 'PetGoldQTECooldownMult'],
        'ClanShip': ['CompanionQTECooldownMult'], 'Helper': ['CompanionQTECooldownMult'],
        'UltraDagger': ['StreamOfBladesCooldownReduction', 'UltraDaggerCount',
                        'UltraDaggerCooldownMult', 'daggerCooldownAutoThrowMult'],
    }
    if branches != expected:
        raise ValueError(f'the per-type switch changed:\n  got      {branches}\n'
                         f'  expected {expected}')
    # Four of the ten types take no arm at all, so the dispatch must land them on the tail itself.
    for name in ('None', 'Fairy', 'ForbiddenContract', 'RoyalContract'):
        if landings[name] != TAIL:
            raise ValueError(f'{name} no longer falls straight through to the clamp')

    # --- the clamp, and the one path that skips it ---
    tail = [(a, b) for a, b, at in traces['cooldown'] if int(at, 16) >= TAIL
            and a in ('static', 'fcmp', 'fcsel')]
    if tail != [('static', 'MIN_COOLDOWN_SECONDS'), ('fcmp', 's0, s10'), ('fcsel', 's0, s0, s10, gt')]:
        raise ValueError(f'the minimum clamp changed shape: {tail}')
    miss = next(at for a, b, at in traces['cooldown'] if a == 'tbz' and b.startswith('w0, #0'))
    if int(next(x for x in traces['cooldown'] if x[2] == miss)[1].split('#')[-1], 16) <= TAIL:
        raise ValueError('the table miss no longer branches past the clamp')

    # MIN_COOLDOWN_SECONDS is set in the static constructor, as a raw float bit pattern.
    init = next((b for a, b, _ in [(i.mnemonic, i.op_str, 0) for i in
                 machine.disasm(body(METHODS['staticInit'][0]), METHODS['staticInit'][0])]
                 if a == 'mov' and re.fullmatch(r'w9, #0x[0-9a-f]+', b)), None)
    if init is None:
        raise ValueError('the static constructor no longer loads a float constant')
    minimum = struct.unpack('<f', struct.pack('<I', int(init.split('#')[1], 16)))[0]

    # --- the schedule around it ---
    want('scheduleCooldown', [('call', 'ContainsKey'), ('call', 'IsQTEUnlocked'),
                              ('fcmp', 's8, #0.0'), ('call', 'GetCooldownDuration'),
                              ('call', 'QTECooldownTimer'), ('call', 'Add'),
                              ('call', 'StartCoroutine')],
         keep={'call', 'fcmp'})
    want('scheduleExpire', [('call', 'ContainsKey'), ('call', 'ContainsKey'),
                            ('fcmp', 's8, #0.0'), ('call', 'get_Item'), ('field', 'expireTime'),
                            ('call', 'QTEExpireTimer'), ('call', 'Add'),
                            ('call', 'StartCoroutine')],
         keep={'call', 'fcmp', 'field'})
    want('cooldownFinished', [('call', 'ContainsKey'), ('call', 'CancelCooldown'),
                              ('fmov', 's0, #-1.00000000'), ('call', 'ScheduleExpire')],
         keep={'call', 'fmov'})
    # ScheduleExpire reads expireTime off the entry directly; GetExpirationDuration is the same
    # read for anyone outside the controller. GetActiveDuration is its sibling on activeTime.
    want('expiration', [('call', 'ContainsKey'), ('call', 'get_Item'), ('field', 'expireTime')],
         keep={'call', 'field'})
    want('active', [('call', 'ContainsKey'), ('call', 'get_Item'), ('field', 'activeTime')],
         keep={'call', 'field'})
    # No talent means always unlocked: the zero check returns true without asking the skill tree.
    want('unlocked', [('call', 'ContainsKey'), ('call', 'get_Item'), ('field', 'TalentId'),
                      ('field', 'TalentId'), ('call', 'IsTalentUnlocked')],
         keep={'call', 'field'})
    want('bonusType', [('call', 'ContainsKey'), ('call', 'get_Item'), ('field', 'CooldownBonusType')],
         keep={'call', 'field'})

    servervars = json.loads((ROOT/'reference/tt2/8.2.0/servervar-defaults.json')
                            .read_text(encoding='utf-8'))['recovered']
    statics = {}
    for field, _ in STATICS.values():
        if field not in servervars:
            raise ValueError(f'{field} has no recovered default')
        statics[field] = servervars[field]['value']

    # --- the shipped table, checked against the fields it has to fill ---
    table = json.loads((ROOT/'reference/tt2/8.2.0/QTEInfo.json').read_text(encoding='utf-8'))
    rows = {r['values']['QTEType']: r['values'] for r in table['records']}
    if set(rows) != {n for n, v in QTE_TYPES.items() if v >= 1}:
        raise ValueError(f'QTEInfo.json no longer covers exactly the nine real types: {sorted(rows)}')
    for name, row in rows.items():
        wanted = row['CooldownBonusType']
        if wanted not in enum['values']:
            raise ValueError(f'{name}: CooldownBonusType {wanted} is not a BonusType')
        if row['TalentID'] and not row['TalentID'].strip():
            raise ValueError(f'{name}: blank-but-present TalentID')
    if rows['Fairy']['TalentID']:
        raise ValueError('the fairy QTE now has a talent; it used to be unlocked for everyone')
    if 'MinCooldown' not in table['schema']:
        raise ValueError('MinCooldown left the table; the limit below is stale')

    document = {
        'version': '8.2.0',
        'role': 'QTE 的冷卻與過期排程：九種 QTE 共用一條公式，'
                '冷卻加成是「減秒」不是倍率，依類型再乘上各自的倍率加成。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': 'QTEController.GetCooldownDuration 先用 QTEType 查 QTEInfo，查不到直接回 0；'
                   '查得到就以 '
                   '(cooldownTime − Bonus(CooldownBonusType)) × (1 + randomness × Random.Range(−1, 1)) '
                   '為基礎值，再依類型乘上額外的倍率加成，最後夾在 '
                   f'MIN_COOLDOWN_SECONDS（{minimum}）以上。'
                   '冷卻加成走的是 fsub 不是 fmul——它從秒數裡扣掉，'
                   '這一點與加成資料表把 FairyCooldown 標成 additive／subtract／seconds 一致。'
                   '排程本身是 ScheduleCooldown → QTECooldownTimer → HandleQTECooldownFinished：'
                   '冷卻結束就取消冷卻、用 expireTime 排一個過期計時器，然後才送出 OnQTEReady；'
                   '沒人點的話過期計時器到期，重新排冷卻。'
                   'ScheduleCooldown 只對 IsQTEUnlocked 的類型排程，'
                   '而 IsQTEUnlocked 在 TalentId 為 0 時直接回 true——'
                   '所以資料表裡沒有天賦的妖精對所有人都是解鎖的。',
        'consequence': '本專案的妖精冷卻原本是自訂的 60 秒，接上之後改為資料表的 120 秒起算、'
                       '扣掉 FairyCooldown（天賦「妖精魅力」與套裝寵物都有來源）、'
                       '再套用 ±10% 的隨機變異；沒點的話 150 秒後消失並重排冷卻。'
                       '寵物與英雄那幾型的倍率加成一併記在這裡，但它們的消費端還沒實作。',
        'methods': {key: fact(address) for key, (address, _) in METHODS.items()},
        'qteTypes': QTE_TYPES,
        'qteStates': QTE_STATES,
        'fields': {field: {'offset': hex(offset), 'type': FIELD_TYPES[field]}
                   for offset, field in FIELDS.items()},
        'minCooldownSeconds': minimum,
        'formulas': {
            'base': '(cooldownTime − Bonus(CooldownBonusType))'
                    ' × (1 + randomness × Random.Range(−1, 1))',
            'clamp': f'max(MIN_COOLDOWN_SECONDS = {minimum}, 上式)',
            'tableMiss': '資料表沒有這一型時直接回 0，而且不套用下限',
            'expire': 'expireTime（查不到回 0）',
            'active': 'activeTime（查不到回 0）',
            'unlocked': 'TalentId 為 0 時恆為解鎖，否則看 SkillTreeModel.IsTalentUnlocked',
            'schedule': 'ScheduleCooldown（僅限已解鎖，且尚未排程）→ 冷卻 → CancelCooldown'
                        ' → ScheduleExpire(expireTime) → OnQTEReady；過期則重排冷卻',
        },
        'typeBranches': {name: {'value': QTE_TYPES[name], 'landsAt': hex(landings[name]),
                                'multipliers': branches[name]} for name in sorted(landings)},
        'ultraDaggerArm': '先在幻影刃執行中時扣掉 StreamOfBladesCooldownReduction，'
                          '再乘 UltraDaggerCooldownMult；'
                          '幻影刃沒在跑、UltraDaggerCount ≥ 1 且待命匕首數 ≥ 該值時，'
                          f'再乘 daggerCooldownAutoThrowMult（{statics["daggerCooldownAutoThrowMult"]}）。',
        'traces': traces,
        'statics': {field: {'offset': hex(offset), 'value': statics[field]}
                    for offset, (field, _) in STATICS.items()},
        'bonusIds': BONUS_IDS,
        'table': {'rows': len(rows),
                  'cooldownBonusTypes': {n: r['CooldownBonusType'] for n, r in sorted(rows.items())},
                  'talents': {n: r['TalentID'] for n, r in sorted(rows.items())}},
        'limits': [
            '資料表有 MinCooldown 一欄（PetAttack 5.852、PetGold 8.778、UltraDagger −2.926 等），'
            '但 QTEInfo 類別沒有對應欄位，ProcessAllQTEs 也沒有讀它——'
            '客戶端的下限只有一個編譯期常數 MIN_COOLDOWN_SECONDS。那一欄在包內是死的。',
            '隨機變異用 UnityEngine.Random，本專案改用自己的確定性亂數；'
            '期望值同樣是 1，但同一個存檔在原生與本專案不會擲出相同的序列。',
            '原生的計時器是 Unity coroutine，App 切到背景時不走；'
            '本專案的冷卻是時間戳，離線時間會算進去。'
            '離線跨過整個 ready 到 expire 的視窗時，本專案從當下重排冷卻，不補發錯過的那幾次。',
            'ClanShip、UltraDagger 與兩種契約的倍率分支已經解出來並記在 typeBranches，'
            '但本專案沒有對應的流派，所以只有資料、沒有消費端。',
            'PetGoldQTECooldownMult 不在本專案匯入的加成資料表裡，'
            '沒有任何天賦、神器、套裝或寵物給它，因此米達斯之心那一支的第三個乘數恆為 1。',
            'QTE 的 activeTime 是「按下去之後效果持續多久」，'
            '第一段只用到 cooldownTime 與 expireTime；activeTime 等寵物與英雄那兩段。',
            '妖精的 expireTime 與 activeTime 都是 150，所以狀態機誤用 activeTime 在妖精身上'
            '**驗不出來**——這是這份資料下無法區分，不是測試的漏洞。'
            '另外八型的兩欄不同，接上消費端之後用錯欄位就會被抓到；'
            'tests/qte.test.mjs 把這個前提釘住了。',
        ],
    }
    out = ROOT/'reference/tt2/8.2.0/qte-evidence.json'
    out.write_bytes((json.dumps(document, ensure_ascii=False, indent=2)+'\n').encode('utf-8'))
    print(f'wrote {out.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
