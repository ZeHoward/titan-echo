"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

Which hits are supposed to show a number, and what does a shadow clone's attack rhythm come from?
Damage feedback looks like pure presentation, so it is easy to invent: pick the sources that seem
interesting, flash the monster, print a number. The package is more specific than that. It carries
41 named damage sources, a switch that maps each one onto the single display option that can turn
it off, a bitmask of which sources play the hit animation at all, and — for the shadow clone — an
attack loop whose interval is one over a rate built from two named bonuses.

This records those four facts, plus one negative result worth keeping: MonsterController holds ten
hard-coded hit tints, and no method in the class ever reads them. They are not current behaviour and
must not be presented as the original's colours.
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

CAN_SHOW = 0x232889C          # MonsterModel.CanShowDamageText(DamageType)
TRY_DAMAGED = 0x231FF24       # MonsterController.TryDamagedAnimation(DamageType)
MONSTER_CTOR = 0x2321474      # MonsterController..ctor, where the ten tints are assigned
CLONE_RATE = 0x223B62C        # ActiveSkillModel.GetCloneAttackRate()
CLONE_LOOP = 0x23D1E6C        # PlayerController.<ShadowCloneAttackLoop>d__132.MoveNext()
GET_BONUS = 0x2714C88         # BonusModel.GetBonus(BonusType, ...)
GH_MAX = 0x21DFBC4            # GHDouble.Max
WAIT_FOR_SECONDS = 0x4703538  # UnityEngine.WaitForSeconds..ctor

# The tint fields, by their struct offset inside MonsterController.
TINT_FIELDS = {0xD0: 'ClanAttackTint', 0xE0: 'ShadowCloneTint', 0xF0: 'ShadowCloneCritTint',
               0x100: 'DoomTint', 0x110: 'GolemCloneTint', 0x120: 'HeavenlyStrikeTint',
               0x130: 'LightningStrikeTint', 0x140: 'HeroQTETint', 0x150: 'DeadlyStrikeTint',
               0x160: 'GoldGunTint'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def enum_values(source, name):
    """Parse one `public enum <name>` block out of dump.cs into {member: value}."""
    match = re.search(r'^public enum '+re.escape(name)+r'[^\n]*\n\{(.*?)^\}', source, re.S | re.M)
    if not match:
        raise ValueError(f'enum {name} not found')
    return {m.group(1): int(m.group(2))
            for m in re.finditer(r'public const '+re.escape(name)+r' (\w+) = (-?\d+);', match.group(1))}


def bool_fields(source, name):
    """Parse the bool backing fields of one class in dump.cs into {offset: field}."""
    match = re.search(r'^public class '+re.escape(name)+r'(?=[\s:])[^\n]*\n\{(.*?)^\}', source, re.S | re.M)
    if not match:
        raise ValueError(f'class {name} not found')
    return {int(m.group(2), 16): m.group(1)
            for m in re.finditer(r'private bool <(\w+)>k__BackingField; // 0x([0-9A-Fa-f]+)', match.group(1))}


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

    def fact(address):
        return {'name': symbols[address], 'rva': hex(address), 'bytesSha256': sha(body(address))}

    expected = {CAN_SHOW: 'MonsterModel$$CanShowDamageText',
                TRY_DAMAGED: 'MonsterController$$TryDamagedAnimation',
                MONSTER_CTOR: 'MonsterController$$.ctor',
                CLONE_RATE: 'ActiveSkillModel$$GetCloneAttackRate',
                CLONE_LOOP: 'PlayerController.<ShadowCloneAttackLoop>d__132$$MoveNext',
                GET_BONUS: 'BonusModel$$GetBonus',
                GH_MAX: 'GHDouble$$Max',
                WAIT_FOR_SECONDS: 'UnityEngine.WaitForSeconds$$.ctor'}
    for address, name in expected.items():
        if symbols.get(address) != name:
            raise ValueError(f'method identity mismatch at {address:#x}: {symbols.get(address)!r}')

    damage_types = enum_values(dump, 'DamageType')
    by_value = {v: k for k, v in damage_types.items()}
    options = bool_fields(dump, 'OptionsController')
    bonus_types = json.loads((ROOT/'reference/tt2/8.2.0/native-bonus-types.json')
                             .read_text(encoding='utf-8'))['values']
    bonus_names = {int(v): k for k, v in bonus_types.items()}

    # --- Which display option can hide which damage number -------------------------------------
    # CanShowDamageText is one switch over (damageType - 1): anything past the table falls through
    # to "always shown", and every case reads one OptionsController bool and returns its negation.
    instructions = list(machine.disasm(body(CAN_SHOW), CAN_SHOW))
    pages, table, adr_base, span, fallthrough = {}, None, None, None, None
    for ins in instructions:
        if ins.mnemonic == 'adrp':
            register, _, page = ins.op_str.partition(', #')
            pages[register] = int(page, 16)
        elif ins.mnemonic == 'add' and ', #' in ins.op_str:
            parts = [p.strip() for p in ins.op_str.split(',')]
            if len(parts) == 3 and parts[1] in pages and parts[0] == parts[1]:
                pages[parts[0]] += int(parts[2].lstrip('#'), 16)
        elif ins.mnemonic == 'cmp' and span is None:
            span = int(ins.op_str.split('#')[1], 16)
        elif ins.mnemonic == 'b.hi':
            fallthrough = int(ins.op_str.lstrip('#'), 16)
        elif ins.mnemonic == 'adr':
            adr_base = int(ins.op_str.split('#')[1], 16)
        elif ins.mnemonic == 'ldrb' and table is None and ', x' in ins.op_str:
            register = ins.op_str.split('[')[1].split(',')[0].strip()
            table = pages.get(register)
    if None in (table, adr_base, span, fallthrough):
        raise ValueError('CanShowDamageText no longer reads a jump table')
    length = span + 1
    if length != max(damage_types.values()):
        raise ValueError(f'switch covers {length} values, enum has {max(damage_types.values())}')

    entries = read(table, length)
    case_field = {}
    for offset in sorted(set(entries)):
        case = adr_base + offset*4
        if case == fallthrough:
            continue
        found = None
        for ins in machine.disasm(read(case, 0x30), case):
            if ins.mnemonic == 'ldrb' and ', #' in ins.op_str:
                found = int(ins.op_str.split('#')[1].rstrip(']'), 16)
                break
        if found is None or found not in options:
            raise ValueError(f'case {case:#x} does not read an OptionsController bool')
        case_field[offset] = options[found]

    by_option, always = {}, []
    for index, offset in enumerate(entries):
        name = by_value[index+1]
        case = adr_base + offset*4
        if case == fallthrough:
            always.append(name)
            continue
        option = case_field[offset]
        by_option.setdefault(option, {'fieldOffset': hex(next(o for o, f in options.items() if f == option)),
                                      'damageTypes': []})['damageTypes'].append(name)

    # --- Which sources play the hit animation ---------------------------------------------------
    mask, limit = 0, None
    for ins in machine.disasm(body(TRY_DAMAGED), TRY_DAMAGED):
        if ins.mnemonic == 'cmp' and limit is None:
            limit = int(ins.op_str.split('#')[1], 16)
        elif ins.mnemonic == 'mov' and ins.op_str.startswith('x9, #'):
            mask = int(ins.op_str.split('#')[1], 16)
        elif ins.mnemonic == 'movk' and ins.op_str.startswith('x9, #'):
            value, _, shift = ins.op_str[len('x9, #'):].partition(', lsl #')
            mask |= int(value, 16) << int(shift)
    if not mask or limit is None:
        raise ValueError('TryDamagedAnimation no longer filters by a bitmask')
    plays = [by_value[v] for v in sorted(by_value) if v <= limit and mask >> v & 1]
    skips = [by_value[v] for v in sorted(by_value) if not (v <= limit and mask >> v & 1)]

    # --- The ten hit tints, and the fact that nothing reads them --------------------------------
    pages, held, tints = {}, {}, {}
    for ins in machine.disasm(body(MONSTER_CTOR), MONSTER_CTOR):
        if ins.mnemonic == 'adrp':
            register, _, page = ins.op_str.partition(', #')
            pages[register] = int(page, 16)
        elif ins.mnemonic == 'ldr' and ins.op_str.startswith('q'):
            match = re.fullmatch(r'(q\d+), \[(x\d+)(?:, #(0x[0-9a-f]+))?\]', ins.op_str)
            if match and match.group(2) in pages:
                held[match.group(1)] = pages[match.group(2)] + int(match.group(3) or '0', 16)
        elif ins.mnemonic == 'stp' and ins.op_str.startswith('q'):
            match = re.fullmatch(r'(q\d+), (q\d+), \[(x\d+), #(0x[0-9a-f]+)\]', ins.op_str)
            if match:
                base = int(match.group(4), 16)
                for step, register in enumerate((match.group(1), match.group(2))):
                    slot = base + step*16
                    if slot in TINT_FIELDS and register in held:
                        tints[TINT_FIELDS[slot]] = held[register]
    if len(tints) != len(TINT_FIELDS):
        raise ValueError(f'only resolved {len(tints)} of {len(TINT_FIELDS)} tints')
    colours = {}
    for name, address in tints.items():
        channels = [round(c, 6) for c in struct.unpack('<4f', read(address, 16))]
        colours[name] = {'rva': hex(address), 'rgba': channels,
                         'hex': '#%02X%02X%02X' % tuple(min(255, max(0, round(c*255))) for c in channels[:3])}

    # Every method of the class, minus the constructor that writes them: does anything read a tint?
    readers, scanned = [], 0
    for address, name in sorted(symbols.items()):
        if not name.startswith('MonsterController$$') or address == MONSTER_CTOR:
            continue
        scanned += 1
        for ins in machine.disasm(body(address), address):
            if ins.mnemonic in ('ldr', 'ldur', 'ldp') and ins.op_str.startswith('q'):
                match = re.search(r'\[x\d+, #(0x[0-9a-f]+)\]', ins.op_str)
                if match and int(match.group(1), 16) in TINT_FIELDS:
                    readers.append({'method': name, 'rva': hex(ins.address)})
    if readers:
        raise ValueError(f'a tint is read after all: {readers}')

    # --- The shadow clone's attack rhythm ------------------------------------------------------
    rate_bonuses, saw_max = [], False
    for ins in machine.disasm(body(CLONE_RATE), CLONE_RATE):
        if ins.mnemonic == 'mov' and ins.op_str.startswith('w1, #'):
            pending = int(ins.op_str.split('#')[1], 16)
        elif ins.mnemonic == 'bl':
            target = int(ins.op_str.lstrip('#'), 16)
            if target == GET_BONUS:
                rate_bonuses.append(bonus_names[pending])
            elif target == GH_MAX:
                saw_max = True
    if len(rate_bonuses) != 2 or not saw_max:
        raise ValueError(f'GetCloneAttackRate changed shape: {rate_bonuses}, max={saw_max}')

    loop_calls = {'GetCloneAttackRate': 0, 'WaitForSeconds': 0}
    divides = 0
    for ins in machine.disasm(body(CLONE_LOOP), CLONE_LOOP):
        if ins.mnemonic == 'bl':
            target = int(ins.op_str.lstrip('#'), 16)
            if target == CLONE_RATE:
                loop_calls['GetCloneAttackRate'] += 1
            elif target == WAIT_FOR_SECONDS:
                loop_calls['WaitForSeconds'] += 1
        elif ins.mnemonic == 'fdiv':
            divides += 1
    if not loop_calls['WaitForSeconds'] or loop_calls['GetCloneAttackRate'] < 2 or divides < 2:
        raise ValueError(f'ShadowCloneAttackLoop changed shape: {loop_calls}, fdiv={divides}')

    document = {
        'version': '8.2.0',
        'role': '傷害回饋的界線：哪些傷害來源會冒數字、歸哪個顯示選項管、哪些會播受擊動畫，'
                '以及影分身的攻擊節奏來自哪個速率。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': f'安裝包有 {len(damage_types)} 個具名傷害來源。CanShowDamageText 是一個 switch，'
                   f'把 {len(by_option)} 組來源各自對到唯一一個可關閉它的顯示選項，其餘 {len(always)} 個永遠顯示；'
                   f'TryDamagedAnimation 另用一個位遮罩決定 {len(plays)} 個來源才播受擊動畫。'
                   '影分身有自己的攻擊迴圈，間隔是 1 ÷ GetCloneAttackRate()，'
                   'GetCloneAttackRate = max(1, Bonus(ShadowCloneSkillAttackRate) × Bonus(CompanionAttackRate))。',
        'consequence': '傷害數字要分幾種、哪一種能被玩家關掉，不必自行編排；'
                       '影分身的傷害不該混進英雄每秒傷害，它是每 1 ÷ 速率 秒獨立打一次。'
                       '十個受擊染色常數雖然在包內，但沒有任何方法讀取，不能當成原版的受擊顏色。',
        'damageTypes': damage_types,
        'damageText': {
            'method': fact(CAN_SHOW),
            'switchTable': {'rva': hex(table), 'length': length, 'caseBase': hex(adr_base),
                            'fallthrough': hex(fallthrough)},
            'byOption': by_option,
            'alwaysShown': always,
            'note': '每個 case 讀 OptionsController 的一個 bool（<名稱>Off）並回傳其反值，'
                    '所以預設全部顯示，玩家關掉的才隱藏。',
        },
        'damagedAnimation': {
            'method': fact(TRY_DAMAGED),
            'mask': hex(mask),
            'maxDamageType': limit,
            'plays': plays,
            'skips': skips,
        },
        'monsterTints': {
            'assignedIn': fact(MONSTER_CTOR),
            'colours': colours,
            'readers': {'scannedMethods': scanned, 'reads': len(readers)},
            'note': '這十個 Color 只在建構式被寫入，MonsterController 的其餘方法都沒有讀；'
                    'StartDamagedAnimation 不看 DamageType，受擊動畫沒有依來源上色。',
        },
        'shadowClone': {
            'rate': {'method': fact(CLONE_RATE), 'bonuses': rate_bonuses, 'base': 1,
                     'formula': 'max(1, Bonus(ShadowCloneSkillAttackRate) × Bonus(CompanionAttackRate))'},
            'attackLoop': {'method': fact(CLONE_LOOP),
                           'interval': '1 ÷ GetCloneAttackRate() 秒',
                           'calls': loop_calls},
        },
        'limits': [
            '兩個 switch 與遮罩是客戶端事實；線上仍可能以伺服器參數改變傷害本身的大小',
            'GetBonus 對加法型加成是否已含 1 未反組譯確認，本專案照資料表語意以 1＋增量代入',
            '影分身的特殊攻擊（ShadowCloneSkillSpecialRate／SpecialChance）另有節奏，本次未核實',
            'Helper 類傷害在 switch 裡落在「永遠顯示」，但原版是否每秒為英雄傷害冒數字需要實機對照，本表不宣稱',
        ],
    }
    target = ROOT/'reference/tt2/8.2.0/damage-text-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Verified {len(damage_types)} damage types: {len(by_option)} display options, '
          f'{len(always)} always shown, {len(plays)} play the hit animation, '
          f'{len(colours)} tints defined and {len(readers)} read')


if __name__ == '__main__':
    main()
