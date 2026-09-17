"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

The project's standing line is that the package carries values for only 28 of the 953 named
[ServerVar] fields — that is true of the two bundled variable *tables*, but it is not the whole
story. ServerVarsModel's class constructor assigns a compiled-in default to most of those fields
before any server payload arrives, which is exactly how this project already sourced the Sword
Master's costBase and costGrowth.

This recovers those defaults wholesale: it walks the class constructor, tracks which register holds
the statics block, and records every scalar (int, float, bool, double) written straight into it.
Fields it cannot resolve — strings, arrays, anything built at runtime — are counted rather than
guessed. Three values this project already sourced by hand act as the self-check.

A default is not a live value: every one of these is a [ServerVar] the server can replace, and the
package's own tables override nine of them already.
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

CCTOR = 0x24AA338                # ServerVarsModel..cctor
STATIC_FIELDS_OFFSET = 0xB8      # Il2CppClass.static_fields
SCALARS = {'int', 'float', 'bool', 'double'}

# Values this project already recovered by hand; if the walk disagrees, the walk is wrong.
SELF_CHECK = {'helperUpgradeBase': 1.0800000429153442,
              'playerUpgradeCostBase': 5.0,
              'playerUpgradeCostGrowth': 1.0750000476837158}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def static_fields(source):
    """{offset: (name, type)} for ServerVarsModel's static fields, from dump.cs."""
    match = re.search(r'^public class ServerVarsModel(?=[\s:])[^\n]*\n\{(.*?)^\}', source, re.S | re.M)
    if not match:
        raise ValueError('ServerVarsModel not found')
    fields = {}
    for kind, name, offset in re.findall(r'public static ([\w\[\]<>., ]+) (\w+); // 0x([0-9A-Fa-f]+)',
                                         match.group(1)):
        fields[int(offset, 16)] = (name, kind.strip())
    return fields


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
    if symbols.get(CCTOR) != 'ServerVarsModel$$.cctor':
        raise ValueError(f'method identity mismatch at {CCTOR:#x}')
    starts = sorted(symbols)
    elf = ELFFile(io.BytesIO(binary))
    machine = Cs(CS_ARCH_ARM64, CS_MODE_ARM)

    def read(start, size):
        segment = next((s for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD'
                        and s['p_vaddr'] <= start and start+size <= s['p_vaddr']+s['p_filesz']), None)
        if segment is None:
            raise ValueError(f'address outside loaded image: {start:#x}')
        return binary[start-segment['p_vaddr']+segment['p_offset']:][:size]

    length = next(a for a in starts if a > CCTOR) - CCTOR
    fields = static_fields(dump)

    pages = {}      # xN -> absolute address from adrp (+ add)
    words = {}      # wN/xN -> integer immediate
    vectors = {}    # qN/dN/sN -> raw bytes loaded from rodata
    bases = {}      # xN -> byte offset into the statics block
    written = {}    # statics offset -> raw bytes

    def forget(register):
        for table in (pages, words, vectors, bases):
            table.pop(register, None)
        if register.startswith('x'):
            forget_pair = 'w'+register[1:]
            for table in (pages, words, vectors, bases):
                table.pop(forget_pair, None)

    def store(offset, data):
        for step in range(0, len(data), 4):
            chunk = data[step:step+4]
            if len(chunk) == 4:
                written[offset+step] = chunk

    for ins in machine.disasm(read(CCTOR, length), CCTOR):
        op, mnemonic = ins.op_str, ins.mnemonic

        m = re.fullmatch(r'(x\d+), #(0x[0-9a-f]+)', op)
        if mnemonic == 'adrp' and m:
            forget(m.group(1))
            pages[m.group(1)] = int(m.group(2), 16)
            continue

        m = re.fullmatch(r'([wx]\d+), ([wx]\d+), #(0x[0-9a-f]+|\d+)', op)
        if mnemonic == 'add' and m:
            target, source, delta = m.group(1), m.group(2), int(m.group(3), 0)
            if source in bases:
                value = bases[source] + delta
                forget(target)
                bases[target] = value
            elif source in pages:
                value = pages[source] + delta
                forget(target)
                pages[target] = value
            else:
                forget(target)
            continue

        # ldr xN, [xM, #0xb8] off a class pointer hands us the statics block.
        m = re.fullmatch(r'(x\d+), \[(x\d+), #(0x[0-9a-f]+)\]', op)
        if mnemonic == 'ldr' and m:
            target = m.group(1)
            forget(target)
            if int(m.group(3), 16) == STATIC_FIELDS_OFFSET:
                bases[target] = 0
            continue

        m = re.fullmatch(r'([wx]\d+), #(0x[0-9a-f]+|\d+)', op)
        if mnemonic == 'mov' and m:
            forget(m.group(1))
            words[m.group(1)] = int(m.group(2), 0)
            continue

        m = re.fullmatch(r'([wx]\d+), #(0x[0-9a-f]+), lsl #(\d+)', op)
        if mnemonic == 'movk' and m:
            words[m.group(1)] = words.get(m.group(1), 0) | (int(m.group(2), 16) << int(m.group(3)))
            continue

        m = re.fullmatch(r'([qds]\d+), \[(x\d+)(?:, #(0x[0-9a-f]+))?\]', op)
        if mnemonic in ('ldr', 'ldur') and m and m.group(2) in pages:
            width = {'q': 16, 'd': 8, 's': 4}[m.group(1)[0]]
            vectors[m.group(1)] = read(pages[m.group(2)] + int(m.group(3) or '0', 16), width)
            continue

        m = re.fullmatch(r'v(\d+)\.2d, (x\d+)', op)
        if mnemonic == 'dup' and m:
            lane = words.get(m.group(2))
            for prefix in 'qds':
                vectors.pop(prefix+m.group(1), None)
            if lane is not None:
                vectors['q'+m.group(1)] = int(lane).to_bytes(8, 'little')*2
            continue

        m = re.fullmatch(r'([qds]\d+), #(0x[0-9a-f]+)', op)
        if mnemonic == 'ldr' and m:
            width = {'q': 16, 'd': 8, 's': 4}[m.group(1)[0]]
            vectors[m.group(1)] = read(int(m.group(2), 16), width)
            continue

        # Stores into the statics block, by register class.
        m = re.fullmatch(r'([wx]\d+|wzr|xzr), \[(x\d+)(?:, #(0x[0-9a-f]+))?\]', op)
        if mnemonic in ('str', 'stur', 'strb', 'sturb', 'strh', 'sturh') and m and m.group(2) in bases:
            offset = bases[m.group(2)] + int(m.group(3) or '0', 16)
            register = m.group(1)
            value = 0 if register.endswith('zr') else words.get(register)
            if value is None:
                continue
            size = {'strb': 1, 'sturb': 1, 'strh': 2, 'sturh': 2}.get(
                mnemonic, 8 if register.startswith('x') else 4)
            raw = int(value).to_bytes(8, 'little')[:size]
            store(offset, raw.ljust(4, b'\0') if size < 4 else raw)
            continue

        m = re.fullmatch(r'([qds]\d+), \[(x\d+)(?:, #(0x[0-9a-f]+))?\]', op)
        if mnemonic in ('str', 'stur') and m and m.group(2) in bases and m.group(1) in vectors:
            store(bases[m.group(2)] + int(m.group(3) or '0', 16), vectors[m.group(1)])
            continue

        m = re.fullmatch(r'([qds]\d+), ([qds]\d+), \[(x\d+)(?:, #(0x[0-9a-f]+))?\]', op)
        if mnemonic in ('stp', 'stnp') and m and m.group(3) in bases:
            first, second = vectors.get(m.group(1)), vectors.get(m.group(2))
            base = bases[m.group(3)] + int(m.group(4) or '0', 16)
            if first:
                store(base, first)
            if second:
                store(base+len(first or second), second)
            continue

        m = re.fullmatch(r'([wx]\d+|wzr|xzr), ([wx]\d+|wzr|xzr), \[(x\d+)(?:, #(0x[0-9a-f]+))?\]', op)
        if mnemonic in ('stp', 'stnp') and m and m.group(3) in bases:
            base = bases[m.group(3)] + int(m.group(4) or '0', 16)
            width = 8 if m.group(1).startswith('x') else 4
            for index, register in enumerate((m.group(1), m.group(2))):
                value = 0 if register.endswith('zr') else words.get(register)
                if value is not None:
                    store(base + index*width, int(value).to_bytes(8, 'little')[:width])
            continue

        # Anything else that writes a register invalidates what we thought it held.
        stores = ('str', 'stur', 'strb', 'sturb', 'strh', 'sturh', 'stp', 'stnp')
        first = re.match(r'v(\d+)\.', op)
        if first and mnemonic not in stores:
            for prefix in 'qds':
                vectors.pop(prefix+first.group(1), None)
            continue
        first = re.match(r'([wxqds]\d+)', op)
        if first and mnemonic not in stores + ('cmp', 'cmn', 'tst', 'b', 'bl'):
            forget(first.group(1))
            if first.group(1)[0] in 'qds':
                for prefix in 'qds':
                    vectors.pop(prefix+first.group(1)[1:], None)

    def value_of(offset, kind):
        raw = written.get(offset)
        if raw is None:
            return None
        if kind == 'bool':
            return bool(raw[0])
        if kind == 'int':
            return int.from_bytes(raw, 'little', signed=True)
        if kind == 'float':
            return struct.unpack('<f', raw)[0]
        if kind == 'double':
            high = written.get(offset+4)
            if high is None:
                return None
            return struct.unpack('<d', raw+high)[0]
        return None

    recovered, missing = {}, {}
    for offset, (name, kind) in sorted(fields.items()):
        if kind not in SCALARS:
            missing.setdefault(kind, []).append(name)
            continue
        value = value_of(offset, kind)
        if value is None:
            missing.setdefault(kind, []).append(name)
        else:
            recovered[name] = {'type': kind, 'offset': hex(offset), 'value': value}

    for name, expected in SELF_CHECK.items():
        got = recovered.get(name, {}).get('value')
        if got is None or abs(got - expected) > 1e-9:
            raise ValueError(f'self-check failed for {name}: {got!r} != {expected!r}')

    # Which of these the package's own tables override, so the two lines of evidence stay distinct.
    overrides = set()
    for table in ('ServerVarOverride.json', 'ServerVarsInfo.json'):
        data = json.loads((ROOT/'reference/tt2/8.2.0'/table).read_text(encoding='utf-8'))
        for record in data['records']:
            overrides.add(record['values']['ServerVarsKey'])
    both = sorted(name for name in recovered if name in overrides)

    counts = {kind: len(names) for kind, names in sorted(missing.items())}
    document = {
        'version': '8.2.0',
        'role': 'ServerVarsModel 在類別建構式裡寫死的預設值：哪些欄位有、值是多少、哪些解不出來。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': f'ServerVarsModel 有 {len(fields)} 個靜態欄位，其中純量（int／float／bool／double）'
                   f'可從類別建構式解出 {len(recovered)} 個的編譯期預設值。'
                   '這與「安裝包的兩張變數表只帶 28 個值」是兩條不同的線索：'
                   f'變數表是資料，這裡是程式裡寫死的預設值，兩者同時存在的只有 {len(both)} 個。',
        'consequence': '先前標記為「原生為伺服器變數、安裝包未帶值」的項目，有一部分其實有預設值可對照；'
                       '但預設值不是線上值——每一個都是 [ServerVar]，伺服器可以整份覆蓋，'
                       '因此引用它時狀態是 default（原生靜態預設值，線上可覆蓋），不是 native。',
        'selfCheck': {name: recovered[name]['value'] for name in SELF_CHECK},
        'recoveredCount': len(recovered),
        'recovered': recovered,
        'unrecovered': {'count': sum(counts.values()), 'byType': counts,
                        'names': {kind: sorted(names) for kind, names in sorted(missing.items())},
                        'note': 'string、int[]、List<float>、GHDouble、TimeSpan 等非純量欄位'
                                '在建構式裡以配置或 InitializeArray 建立，本表不解其內容；'
                                '純量欄位若解不出來，通常是值由執行期計算或以本表未涵蓋的指令形式寫入。'},
        'alsoInPackageTables': both,
        'limits': [
            '預設值不是線上值：這些欄位都是 [ServerVar]，伺服器可覆蓋',
            '解析只承認「寫進靜態區塊」的指令，其餘一律列為未解出，不猜測',
            '本表不判斷欄位是否被實際使用，只記錄它的編譯期預設值',
        ],
    }
    target = ROOT/'reference/tt2/8.2.0/servervar-defaults.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Recovered {len(recovered)} of {len(fields)} static defaults '
          f'({sum(counts.values())} unresolved: ' + ', '.join(f'{k} {v}' for k, v in counts.items()) + ')')


if __name__ == '__main__':
    main()
