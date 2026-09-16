"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps."""
import hashlib
import io
import json
import pathlib
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCAL = ROOT / 'work/apk-analysis'
sys.path.insert(0, str(LOCAL/'python-libs'))
from capstone import Cs, CS_ARCH_ARM64, CS_MODE_ARM
from elftools.elf.elffile import ELFFile

PARSER = 0x2287a10

def sha(data):
    return hashlib.sha256(data).hexdigest()

def main():
    baseline = json.loads((ROOT/'docs/reference-baseline.json').read_text())
    package = (LOCAL/'tap-titans-2-8.2.0.xapk').read_bytes()
    if sha(package) != baseline['package']['sha256']:
        raise ValueError('package mismatch')
    binary = (LOCAL/'libil2cpp.so').read_bytes()
    with zipfile.ZipFile(io.BytesIO(package)) as outer:
        with zipfile.ZipFile(io.BytesIO(outer.read('config.arm64_v8a.apk'))) as apk:
            if binary != apk.read('lib/arm64-v8a/libil2cpp.so'):
                raise ValueError('native binary differs from pinned APK')
    script = json.loads((LOCAL/'dump/script.json').read_text())
    symbols = {m['Address']: m['Name'] for m in script['ScriptMethod']}
    elf = ELFFile(io.BytesIO(binary))
    def code(start, size):
        segment = next(s for s in elf.iter_segments() if s['p_type']=='PT_LOAD' and s['p_vaddr']<=start and start+size<=s['p_vaddr']+s['p_filesz'])
        offset = start-segment['p_vaddr']+segment['p_offset']
        return binary[offset:offset+size]
    def instruction(address, mnemonic, operands):
        actual = next(Cs(CS_ARCH_ARM64, CS_MODE_ARM).disasm(code(address, 4), address))
        if (actual.mnemonic, actual.op_str) != (mnemonic, operands):
            raise ValueError(f'instruction changed at {address:x}')
    # The header row is walked by ascending index and each name is stored with its own index.
    observations = [
        (0x2287b50, 'bl', '#0x34c044c'),
        (0x2287f84, 'bl', '#0x395e88c'),
        (0x2287fa4, 'mov', 'w23, wzr'),
        (0x2287fbc, 'bl', '#0x395e88c'),
        (0x2287fd0, 'mov', 'w2, w23'),
        (0x2287fd4, 'bl', '#0x34c0dd0'),
        (0x2287fdc, 'add', 'w23, w23, #1'),
        (0x2287fe4, 'b.lt', '#0x2287fb0'),
        (0x2288004, 'bl', '#0x396035c'),
        (0x2288020, 'bl', '#0x2288294'),
    ]
    for address, mnemonic, operands in observations:
        instruction(address, mnemonic, operands)
    expected_symbols = {PARSER: 'InfoDocs$$ParseInfoDoc',
        0x34c044c: 'System.Collections.Generic.Dictionary<object, int>$$.ctor',
        0x34c0dd0: 'System.Collections.Generic.Dictionary<object, int>$$set_Item',
        0x395e88c: 'System.Collections.Generic.List<object>$$get_Item',
        0x396035c: 'System.Collections.Generic.List<object>$$RemoveAt',
        0x2288294: 'InfoDoc$$.ctor', 0x22881cc: 'InfoDocs$$ParseQuotes'}
    for address, name in expected_symbols.items():
        if symbols.get(address) != name:
            raise ValueError(f'method identity mismatch: {address:x}')
    dump = (LOCAL/'dump/dump.cs').read_text(encoding='utf-8')
    if 'public void .ctor(List<List<string>> data, Dictionary<string, int> columnDict, string sheetName) { }' not in dump:
        raise ValueError('InfoDoc column dictionary shape changed')
    result = dict(version='8.2.0', scope='InfoDocs.ParseInfoDoc column dictionary',
        packageSha256=sha(package), binarySha256=sha(binary),
        metadataSha256=sha((LOCAL/'global-metadata.dat').read_bytes()),
        scriptSha256=sha((LOCAL/'dump/script.json').read_bytes()),
        columnPolicy='last-header-index-wins',
        parserRva=hex(PARSER), parserBytesSha256=sha(code(PARSER, 0x63c)),
        evidence=dict(headerOrder='ascending zero-based header index',
            assignmentCallRva='0x2287fd4', assignmentTarget='Dictionary<string, int>.set_Item',
            storedValue='the header index being visited',
            consequence='a repeated header name resolves to its last column; earlier columns become unreachable by name',
            headerRowRemovedRva='0x2288004',
            checkedInstructionAddresses=[hex(a) for a, _, _ in observations]),
        limits=['Column name resolution only; this says nothing about cell meaning, units or activation',
                'Applies to every sheet parsed through InfoDocs, not to a single table',
                'Shadowed columns are still published in the catalog so no source value is dropped'])
    target = ROOT/'reference/tt2/8.2.0/infodoc-parser-evidence.json'
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Verified InfoDoc column dictionary policy against {len(observations)} instruction checks')

if __name__ == '__main__':
    main()
