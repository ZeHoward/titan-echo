"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

Astral Awakening (the Helper QTE, QTEType 5) is two mechanisms sharing one bonus, and in this
package only one of them can ever fire.

  * The ORB. Each tap sends it to the other side and lands a hit worth
    GetAllHelperDPS x Bonus(HelperQTEDamage) x (offset + mult x power^expo) - all three
    coefficients are [ServerVar]s with compiled-in defaults. This is buildable.
  * The BUFF. HelperQTEModifyDamage multiplies AllHelperDamage by
    Pow(Bonus(HelperQTEDamage), Min(power, Bonus(HelperQTECount))). HelperQTECount is additive,
    so with no source it reads 0, Min(power, 0) is 0, and Pow(x, 0) is 1. It cannot fire.

HelperQTECount also caps the bounces: HelperQTEAnim sets isLastOrbShot from
`bounceCount >= (int)Bonus(HelperQTECount)`, which at 0 is true on the very first shot. So the
whole bounce loop degenerates to one hit - not because this project simplified it, but because
nothing in the 8.2 tables grants that bonus. Implemented the native way regardless, so a future
source makes it bounce for real.
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
    'ready': (0x222C848, 'HelperController$$QTEReadyHandler'),
    'init': (0x222C860, 'HelperController$$InitHelperQTE'),
    'tapped': (0x222D770, 'HelperController$$HelperQTETapped'),
    'anim': (0x222CEE4, 'HelperController$$HelperQTEAnim'),
    'orbDamage': (0x222D574, 'HelperController$$HelperQTEDamageMonster'),
    'buff': (0x222D32C, 'HelperController$$HelperQTEModifyDamage'),
    'reduce': (0x222D560, 'HelperController$$ReduceHelperQTEPower'),
}

BONUS_IDS = {'HelperQTEDamage': 279, 'HelperQTECount': 278, 'HelperQTEDuration': 280,
             'HelperQTECooldown': 277, 'AllHelperDamage': 40}

FIELDS = {0x88: ('<HelperQTEPower>k__BackingField', 'int'),
          0x8C: ('<HelperQTEBounceCount>k__BackingField', 'int'),
          0x90: ('<HelperQTEActiveDuration>k__BackingField', 'float'),
          0x94: ('<activeQTE>k__BackingField', 'bool'),
          0xC0: ('isLeftSide', 'bool'), 0xC1: ('isLastOrbShot', 'bool')}
SHORT = {'<HelperQTEPower>k__BackingField': 'HelperQTEPower',
         '<HelperQTEBounceCount>k__BackingField': 'HelperQTEBounceCount',
         '<HelperQTEActiveDuration>k__BackingField': 'HelperQTEActiveDuration',
         '<activeQTE>k__BackingField': 'activeQTE',
         'isLeftSide': 'isLeftSide', 'isLastOrbShot': 'isLastOrbShot'}

STATICS = {0xF0: ('helperQTEDamageMult', 'float'), 0xF4: ('helperQTEDamageOffset', 'float'),
           0xF8: ('helperQTEDamageExpo', 'float')}

HELPER_QTE_TYPE = 5
HELPER_QTE_DAMAGE_TYPE = 8   # DamageType.HelperQTE

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

    def body(address, cap=0x1800):
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

    if not re.search(r'public const DamageType HelperQTE = '+str(HELPER_QTE_DAMAGE_TYPE)+r';', dump):
        raise ValueError(f'DamageType.HelperQTE is no longer {HELPER_QTE_DAMAGE_TYPE}')
    helper = re.search(r'^public class HelperController(?=[\s:])[^\n]*\n\{(.*?)^\t// (?:Properties|Methods)',
                       dump, re.S | re.M)
    for offset, (field, kind) in FIELDS.items():
        if not re.search(r'private '+kind+' '+re.escape(field)+r'; // 0x'+f'{offset:X}'+r'\b',
                         helper.group(1)):
            raise ValueError(f'HelperController.{field} is no longer a {kind} at {offset:#x}')
    block = re.search(r'^public class ServerVarsModel(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)
    for offset, (field, kind) in STATICS.items():
        if not re.search(r'public static '+kind+' '+field+r'; // 0x'+f'{offset:X}'+r'\b', block):
            raise ValueError(f'{field} is no longer a {kind} at {offset:#x}')

    instructions = {}
    for address, _ in METHODS.values():
        for ins in machine.disasm(body(address), address):
            instructions[ins.address] = ins

    def bonus_at(address, floor):
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
                # `str wzr, [x, #imm]` zeroes a field; the zero register is not [swdq]N.
                m = re.fullmatch(r'(?:[swdq]\d+|[wx]zr), \[x\d+, #(0x[0-9a-f]+)\]', ins.op_str)
                if m and int(m.group(1), 16) in STATICS:
                    events.append(('static', STATICS[int(m.group(1), 16)][0], hex(ins.address)))
                elif m and int(m.group(1), 16) in FIELDS:
                    kind = 'read' if ins.mnemonic in ('ldr', 'ldrb') else 'write'
                    events.append((kind, SHORT[FIELDS[int(m.group(1), 16)][0]], hex(ins.address)))
            elif ins.mnemonic in ('cmp', 'cset', 'add', 'sub', 'bic', 'fmul', 'fadd', 'scvtf', 'eor'):
                if ins.op_str.startswith(('w', 's', 'v')) and not ins.op_str.startswith('sp,'):
                    events.append((ins.mnemonic, ins.op_str, hex(ins.address)))
            elif ins.mnemonic == 'bl' and ins.op_str.startswith('#'):
                target = int(ins.op_str.lstrip('#'), 16)
                name = symbols.get(target, '')
                short = name.split('$$')[-1]
                if target in (GET_BONUS, MODIFY_BONUS):
                    got = bonus_at(ins.address, address)
                    events.append(('ModifyBonus' if target == MODIFY_BONUS else 'GetBonus',
                                   by_id.get(got, 'via register' if got is None else f'BonusType#{got}'),
                                   hex(ins.address)))
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

    # --- the entry point: only QTEType 5, and only when one is not already running ---
    want('ready', [('cmp', f'w1, #{HELPER_QTE_TYPE}'), ('read', 'activeQTE'),
                   ('call', 'InitHelperQTE')],
         keep={'cmp', 'read', 'call'})

    # --- init needs a helper on BOTH sides, and starts the bounce count at zero ---
    init = kinds('init', {'call', 'write', 'cmp'})
    if [b for a, b, _ in traces['init'] if a == 'call'].count('GetUnlockedHelpersOnSide') != 2:
        raise ValueError('InitHelperQTE no longer asks for both sides')
    if ('write', 'HelperQTEBounceCount') not in init or ('write', 'activeQTE') not in init:
        raise ValueError(f'InitHelperQTE changed shape: {init}')

    # --- each tap bumps power and bounce count together, then refreshes the expiry ---
    tap = kinds('tapped', {'read', 'write', 'add', 'call'})
    if tap[:3] != [('read', 'HelperQTEPower'), ('add', 'v0.2s, v1.2s, v0.2s'),
                   ('write', 'HelperQTEPower')]:
        raise ValueError(f'HelperQTETapped changed shape: {tap}')
    if ('call', 'RefreshExpire') not in tap:
        raise ValueError('a tap no longer refreshes the QTE expiry')

    # --- the bounce cap: isLastOrbShot = bounceCount >= (int)Bonus(HelperQTECount) ---
    anim = kinds('anim', {'GetBonus', 'read', 'write', 'cmp', 'cset', 'call'})
    head = [e for e in anim if e[0] in ('read', 'GetBonus', 'call', 'cmp', 'cset')]
    if ('read', 'HelperQTEBounceCount') not in head or ('GetBonus', 'HelperQTECount') not in head:
        raise ValueError(f'HelperQTEAnim no longer caps bounces with HelperQTECount: {head[:8]}')
    order = [i for i, e in enumerate(anim)]
    bounce_at = next(int(at, 16) for a, b, at in traces['anim']
                     if a == 'read' and b == 'HelperQTEBounceCount')
    count_at = next(int(at, 16) for a, b, at in traces['anim']
                    if a == 'GetBonus' and b == 'HelperQTECount')
    cset = next(((b, int(at, 16)) for a, b, at in traces['anim']
                 if a == 'cset' and int(at, 16) > count_at), None)
    if cset is None or not cset[0].endswith(', ge'):
        raise ValueError(f'the last-orb test is no longer a >= comparison: {cset}')
    if not (bounce_at < count_at < cset[1]):
        raise ValueError('the bounce cap reads in an unexpected order')
    if ('write', 'isLastOrbShot') not in anim:
        raise ValueError('HelperQTEAnim no longer records isLastOrbShot')

    # --- the orb hit: dps x bonus x (offset + mult x power^expo), as DamageType.HelperQTE ---
    orb = kinds('orbDamage', {'static', 'read', 'GetBonus', 'call', 'fmul', 'fadd', 'scvtf'})
    if orb[:3] != [('read', 'HelperQTEPower'), ('scvtf', 's0, s0'), ('static', 'helperQTEDamageExpo')]:
        raise ValueError(f'the orb damage head changed: {orb[:6]}')
    for wanted in (('static', 'helperQTEDamageMult'), ('static', 'helperQTEDamageOffset'),
                   ('call', 'GetAllHelperDPS'), ('GetBonus', 'HelperQTEDamage'),
                   ('call', 'QueueMonsterAttack')):
        if wanted not in orb:
            raise ValueError(f'the orb damage no longer uses {wanted}')
    if [b for a, b, _ in traces['orbDamage'] if a == 'fmul'] != ['s0, s9, s8'] or \
            [b for a, b, _ in traces['orbDamage'] if a == 'fadd'] != ['s8, s10, s0']:
        raise ValueError('the orb damage is no longer offset + mult x pow')
    attack = next((at for a, b, at in traces['orbDamage'] if a == 'call' and b == 'QueueMonsterAttack'), None)
    kind = next((int(i.op_str.split('#')[1], 0) for i in
                 (instructions.get(int(attack, 16)-n*4) for n in range(1, 8)) if i is not None
                 and i.mnemonic == 'mov' and re.fullmatch(r'w2, #\d+', i.op_str)), None)
    if kind != HELPER_QTE_DAMAGE_TYPE:
        raise ValueError(f'the orb hit is queued as DamageType {kind}, not HelperQTE')

    # --- the buff half: Pow(HelperQTEDamage, Min(power, HelperQTECount)) into AllHelperDamage ---
    buff = kinds('buff', {'GetBonus', 'ModifyBonus', 'read', 'call'})
    if buff != [('GetBonus', 'HelperQTEDamage'), ('GetBonus', 'HelperQTECount'),
                ('read', 'HelperQTEPower'), ('call', 'op_Implicit'), ('call', 'Min'),
                ('call', 'op_Explicit'), ('call', 'Pow'), ('ModifyBonus', 'AllHelperDamage')]:
        raise ValueError(f'HelperQTEModifyDamage changed shape: {buff}')

    # --- reducing power is clamped at zero, then the buff is recomputed ---
    want('reduce', [('read', 'HelperQTEPower'), ('sub', 'w8, w8, #1'),
                    ('bic', 'w8, w8, w8, asr #31'), ('write', 'HelperQTEPower'),
                    ('call', 'HelperQTEModifyDamage')],
         keep={'read', 'write', 'sub', 'bic', 'call'})

    servervars = json.loads((ROOT/'reference/tt2/8.2.0/servervar-defaults.json')
                            .read_text(encoding='utf-8'))['recovered']
    statics = {}
    for field, _ in STATICS.values():
        if field not in servervars:
            raise ValueError(f'{field} has no recovered default')
        statics[field] = servervars[field]['value']

    coverage = json.loads((ROOT/'docs/bonus-coverage.json').read_text(encoding='utf-8'))
    rows = {r['id']: r for r in coverage['rows']}
    if rows['HelperQTECount']['sources']:
        raise ValueError('HelperQTECount now has a source; the orb really bounces and the buff fires')
    if not rows['HelperQTEDamage']['sources']:
        raise ValueError('HelperQTEDamage lost its source; the orb hit would do nothing')

    table = json.loads((ROOT/'reference/tt2/8.2.0/QTEInfo.json').read_text(encoding='utf-8'))
    row = next(r['values'] for r in table['records'] if r['values']['QTEType'] == 'Helper')

    document = {
        'version': '8.2.0',
        'role': '星界覺醒（Helper QTE）：光球撞擊可以做，持續期間的英雄傷害加成做了不會生效。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': 'QTEReadyHandler 只處理 QTEType 5，而且 activeQTE 已經開著就不再開一次；'
                   'InitHelperQTE 要求**兩側各至少有一個已解鎖的英雄**，'
                   '把 HelperQTEBounceCount 歸零、activeQTE 設為 true，再隨機挑一側的一位英雄起手。'
                   '玩家每點一次，HelperQTETapped 用一道 NEON 加法把 HelperQTEPower 與 '
                   'HelperQTEBounceCount **同時各加 1**，並呼叫 QTEController.RefreshExpire 重設過期。'
                   '光球撞到怪的那一擊是 '
                   'GetAllHelperDPS × Bonus(HelperQTEDamage) × '
                   f'(helperQTEDamageOffset({statics["helperQTEDamageOffset"]}) + '
                   f'helperQTEDamageMult({statics["helperQTEDamageMult"]}) × '
                   f'威力^helperQTEDamageExpo({statics["helperQTEDamageExpo"]}))，'
                   f'以 DamageType.HelperQTE（{HELPER_QTE_DAMAGE_TYPE}）送進 QueueMonsterAttack。'
                   '**彈跳次數的上限是 Bonus(HelperQTECount)**：HelperQTEAnim 以 '
                   'isLastOrbShot = (HelperQTEBounceCount >= (int)Bonus(HelperQTECount)) 決定是不是最後一發。'
                   '另一半 HelperQTEModifyDamage 則把 AllHelperDamage 乘上 '
                   'Pow(Bonus(HelperQTEDamage), Min(HelperQTEPower, Bonus(HelperQTECount)))。',
        'consequence': '本專案接上光球那一半：學了天賦「星界覺醒」之後，QTE 冷卻結束就能點，'
                       '每點一次造成一次撞擊傷害。'
                       '**但 HelperQTECount 在本專案沒有任何來源**（加法型，中性值 0），'
                       '所以 isLastOrbShot 從第一發就成立，整套彈跳退化成一次撞擊；'
                       '同樣的 0 也讓 Min(威力, 0) = 0、Pow(加成, 0) = 1，'
                       '**持續期間的英雄傷害加成那一半做了也不會生效**。'
                       '兩邊都照原生寫，哪天那個加成有了來源就會自然運作。',
        'methods': {key: fact(address) for key, (address, _) in METHODS.items()},
        'qteType': HELPER_QTE_TYPE,
        'damageType': {'HelperQTE': HELPER_QTE_DAMAGE_TYPE},
        'fields': {SHORT[field]: {'offset': hex(offset), 'type': kind}
                   for offset, (field, kind) in FIELDS.items()},
        'formulas': {
            'orbHit': 'GetAllHelperDPS × Bonus(HelperQTEDamage)'
                      ' × (helperQTEDamageOffset + helperQTEDamageMult × 威力^helperQTEDamageExpo)',
            'tap': '一次點擊讓 HelperQTEPower 與 HelperQTEBounceCount 各加 1，並重設過期計時',
            'lastOrb': 'HelperQTEBounceCount >= (int)Bonus(HelperQTECount)',
            'buff': 'AllHelperDamage ×= Pow(Bonus(HelperQTEDamage),'
                    ' Min(HelperQTEPower, Bonus(HelperQTECount)))',
            'reducePower': 'HelperQTEPower = max(0, HelperQTEPower − 1)，然後重算上面那個加成',
            'sides': '兩側各要有至少一個已解鎖的英雄，否則這一輪不開始',
        },
        'traces': traces,
        'statics': {field: {'offset': hex(offset), 'value': statics[field]}
                    for offset, (field, _) in STATICS.items()},
        'bonusIds': BONUS_IDS,
        'table': {name: row[name] for name in sorted(row)},
        'blocked': {
            'buff': '持續期間的英雄傷害加成在本專案做了也不會生效。'
                    'HelperQTEModifyDamage 算的是 Pow(HelperQTEDamage, Min(威力, HelperQTECount))，'
                    '而 HelperQTECount 是加法型、本專案沒有任何來源給它，中性值 0，'
                    '所以指數恆為 0、整個乘數恆為 1。'
                    '天賦「星界覺醒」給的是 HelperQTEDamage，不是 HelperQTECount。',
        },
        'limits': [
            'HelperQTECount 沒有來源，所以彈跳上限是 0——**光球只會撞一次**。'
            '這是資料決定的，不是本專案簡化的；引擎照原生以 '
            '「威力 > 上限就是最後一發」判斷，有來源時會自然彈更多次。',
            'HelperQTEDuration（280）與 HelperQTECooldown（277）本專案也沒有來源。'
            '前者是原生的 HelperQTEActiveDuration，後者是 QTE 冷卻的減秒，'
            '兩者缺來源只代表沒有加成，不影響基礎值。',
            '原生的 HelperQTEPower 與 HelperQTEBounceCount 是兩個欄位：點擊時同時加一，'
            '但 ReduceHelperQTEPower（動畫逾時用）只減威力。'
            '本專案沒有那個逾時觸發，兩者恆等，所以合併成一個 qteHelperPower。',
            '原生的光球是場上實體，在兩側英雄之間飛；本專案沒有實體，'
            '所以把「點一下讓它再飛一趟」併進戰鬥區的點擊，撞擊傷害立即結算。',
            '兩側各要有一個已解鎖英雄那個條件沒有實作：本專案的英雄沒有左右之分，'
            '而能學到這個天賦的存檔一定早就解鎖了大量英雄，實務上恆為真。',
            'DamageType.HelperQTE（8）在 GetTitanSkip 與 GetStageSkip 都沒有自己的那一支，'
            '所以這一擊不跳泰坦也不跳關——與 skip-evidence.json 的配對表一致。',
        ],
    }
    out = ROOT/'reference/tt2/8.2.0/helper-qte-evidence.json'
    out.write_bytes((json.dumps(document, ensure_ascii=False, indent=2)+'\n').encode('utf-8'))
    print(f'wrote {out.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
