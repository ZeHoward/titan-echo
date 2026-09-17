"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

Every bonus in the game starts from a base value before any artifact, talent, pet or equipment
touches it — the tap crit chance, the Chesterson spawn chance, and so on. Those bases are not in any
bundled table: BonusModel.SetDefaultBonuses builds a dictionary of them at startup, reading each one
out of a ServerVarsModel static.

This walks that method and pairs every `Dictionary.Add(key, value)` it makes: the key is a BonusType
and the value is the static it was read from. The result is the base value of each bonus, by name,
with the field it came from — so the engine's own bases can be checked against it instead of being
carried over from the 7.5 baseline.
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

SET_DEFAULTS = 0x27147C4         # BonusModel.SetDefaultBonuses
DICT_ADD = 0x348862C             # Dictionary<Int32Enum, float>.Add
STATIC_FIELDS_OFFSET = 0xB8      # Il2CppClass.static_fields


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
    for address, name in {SET_DEFAULTS: 'BonusModel$$SetDefaultBonuses',
                          DICT_ADD: 'System.Collections.Generic.Dictionary<Int32Enum, float>$$Add'}.items():
        if symbols.get(address) != name:
            raise ValueError(f'method identity mismatch at {address:#x}: {symbols.get(address)!r}')
    starts = sorted(symbols)
    elf = ELFFile(io.BytesIO(binary))
    machine = Cs(CS_ARCH_ARM64, CS_MODE_ARM)

    def read(start, size):
        segment = next((s for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD'
                        and s['p_vaddr'] <= start and start+size <= s['p_vaddr']+s['p_filesz']), None)
        if segment is None:
            raise ValueError(f'address outside loaded image: {start:#x}')
        return binary[start-segment['p_vaddr']+segment['p_offset']:][:size]

    length = next(a for a in starts if a > SET_DEFAULTS) - SET_DEFAULTS
    body = read(SET_DEFAULTS, min(length, 0x2000))

    # ServerVarsModel's static fields, so a value can be named rather than just numbered.
    block = re.search(r'^public class ServerVarsModel(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)
    static_names = {int(offset, 16): (name, kind.strip()) for kind, name, offset
                    in re.findall(r'public static ([\w\[\]<>., ]+) (\w+); // 0x([0-9A-Fa-f]+)', block)}
    bonus_types = json.loads((ROOT/'reference/tt2/8.2.0/native-bonus-types.json')
                             .read_text(encoding='utf-8'))['values']
    bonus_names = {int(value): name for name, value in bonus_types.items()}
    defaults = json.loads((ROOT/'reference/tt2/8.2.0/servervar-defaults.json')
                          .read_text(encoding='utf-8'))['recovered']

    statics, key, source, zeroed = set(), None, None, False
    entries, unresolved = {}, []
    for ins in machine.disasm(body, SET_DEFAULTS):
        op = ins.op_str
        m = re.fullmatch(r'(x\d+), \[(x\d+), #(0x[0-9a-f]+)\]', op)
        if ins.mnemonic == 'ldr' and m:
            if int(m.group(3), 16) == STATIC_FIELDS_OFFSET:
                statics.add(m.group(1))
            else:
                statics.discard(m.group(1))
            continue
        m = re.fullmatch(r'w1, #(0x[0-9a-f]+|\d+)', op)
        if ins.mnemonic == 'mov' and m:
            key = int(m.group(1), 0)
            continue
        m = re.fullmatch(r's0, \[(x\d+), #(0x[0-9a-f]+)\]', op)
        if ins.mnemonic in ('ldr', 'ldur') and m and m.group(1) in statics:
            source, zeroed = int(m.group(2), 16), False
            continue
        if ins.mnemonic in ('movi', 'fmov') and op.startswith(('v0', 's0')) and '#0' in op:
            source, zeroed = None, True
            continue
        if ins.mnemonic == 'bl' and int(op.lstrip('#'), 16) == DICT_ADD:
            name = bonus_names.get(key)
            if name is None:
                unresolved.append({'key': key, 'reason': 'BonusType 沒有這個值'})
            elif zeroed:
                entries[name] = {'bonusType': key, 'value': 0.0, 'source': 'zeroed in place'}
            elif source is None:
                unresolved.append({'key': key, 'bonus': name, 'reason': '值不是直接從靜態欄位載入'})
            else:
                field, _ = static_names.get(source, (None, None))
                value = defaults.get(field, {}).get('value') if field else None
                if field is None or value is None:
                    unresolved.append({'key': key, 'bonus': name, 'offset': hex(source),
                                       'reason': '靜態欄位沒有解出預設值'})
                else:
                    entries[name] = {'bonusType': key, 'value': value, 'field': field,
                                     'offset': hex(source)}
            key, source, zeroed = None, None, False
    # The method sets 14 bases; anything much smaller means the walk stopped pairing them.
    if len(entries) < 12:
        raise ValueError(f'only paired {len(entries)} defaults; the method shape probably changed')
    for required in ('CritChance', 'ChestChance'):
        if required not in entries:
            raise ValueError(f'{required} is no longer given a default here')

    document = {
        'version': '8.2.0',
        'role': '每個加成在任何神器、天賦、寵物、裝備之前的基礎值：'
                'BonusModel.SetDefaultBonuses 建立的那張字典。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': f'BonusModel.SetDefaultBonuses 逐筆 Dictionary.Add(BonusType, 值)，'
                   f'值都是從 ServerVarsModel 的靜態欄位讀來的。配對出 {len(entries)} 個加成的基礎值，'
                   f'另有 {len(unresolved)} 筆無法配對。'
                   f'其中暴擊機率的基礎值是 playerCritChance，'
                   f'寶箱泰坦機率是 chestersonChance。',
        'consequence': '引擎裡寫死的基礎機率可以對照這張表校正；'
                       '但這些值同樣是 [ServerVar] 的編譯期預設值，線上可覆蓋，狀態為 default。',
        'method': {'name': symbols[SET_DEFAULTS], 'rva': hex(SET_DEFAULTS), 'bytesSha256': sha(body)},
        'defaults': dict(sorted(entries.items())),
        'unresolved': unresolved,
        'limits': [
            '這是加成的「基礎值」，不是最終值：實際數值還要經過神器、天賦、寵物與裝備',
            '預設值不是線上值，伺服器可覆蓋',
            '沒有配對成功的項目逐筆列出原因，不臆測',
        ],
    }
    target = ROOT/'reference/tt2/8.2.0/bonus-defaults-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Paired {len(entries)} bonus defaults, {len(unresolved)} unresolved; '
          f'CritChance={entries["CritChance"]["value"]}, ChestChance={entries["ChestChance"]["value"]}')


if __name__ == '__main__':
    main()
