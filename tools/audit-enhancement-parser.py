"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps."""
import hashlib
import io
import json
import pathlib
import re
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCAL = ROOT / 'work/apk-analysis'
sys.path.insert(0, str(LOCAL/'python-libs'))
from capstone import Cs, CS_ARCH_ARM64, CS_MODE_ARM
from elftools.elf.elffile import ELFFile

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
    strings = {s['Address']: s['Value'] for s in script['ScriptString']}
    elf = ELFFile(io.BytesIO(binary))
    relocations = {r['r_offset']: r['r_addend'] for r in elf.get_section_by_name('.rela.dyn').iter_relocations()}
    def code(start, size):
        segment = next(s for s in elf.iter_segments() if s['p_type']=='PT_LOAD' and s['p_vaddr']<=start and start+size<=s['p_vaddr']+s['p_filesz'])
        offset = start-segment['p_vaddr']+segment['p_offset']
        return binary[offset:offset+size]
    def instruction(address, mnemonic, operands):
        actual = next(Cs(CS_ARCH_ARM64, CS_MODE_ARM).disasm(code(address, 4), address))
        if (actual.mnemonic, actual.op_str) != (mnemonic, operands):
            raise ValueError(f'instruction changed at {address:x}')
    observations = [
        (0x2189a6c, 'mov', 'w20, wzr'),
        (0x2189b24, 'tbz', 'w22, #0, #0x2189bd4'),
        (0x2189b28, 'tbz', 'w23, #0, #0x2189bd4'),
        (0x2189b2c, 'tbz', 'w24, #0, #0x2189bd4'),
        (0x2189b30, 'tbz', 'w25, #0, #0x2189bd4'),
        (0x2189b34, 'tbz', 'w0, #0, #0x2189bd4'),
        (0x2189bd0, 'bl', '#0x3481b74'),
        (0x2189bdc, 'add', 'w20, w20, #1'),
        (0x2189be8, 'b.lt', '#0x2189a70'),
        (0x3481b78, 'mov', 'w3, #1'),
        (0x3481b84, 'b', '#0x3482614'),
    ]
    for address, mnemonic, operands in observations:
        instruction(address, mnemonic, operands)
    expected_symbols = {0x218994c: 'ParseEquipmentEnhancementScalingInfo',
        0x3481b74: 'System.Collections.Generic.Dictionary<Int32Enum, object>$$set_Item',
        0x3482614: 'System.Collections.Generic.Dictionary<Int32Enum, object>$$TryInsert'}
    for address, suffix in expected_symbols.items():
        if not symbols.get(address, '').endswith(suffix):
            raise ValueError(f'method identity mismatch: {address:x}')
    expected_strings = {0x4c18588: 'C_EquipmentEnhancementScalingInfo', 0x4c0f130: 'BonusType',
        0x4c185b8: 'AttributeBase', 0x4c185a0: 'PowerBase', 0x4c185b0: 'PowerInc', 0x4c185a8: 'PowerExp'}
    for address, value in expected_strings.items():
        if strings.get(relocations.get(address)) != value:
            raise ValueError(f'field identity mismatch: {address:x}')
    dump = (LOCAL/'dump/dump.cs').read_text(encoding='utf-8')
    if not re.search(r'public const InsertionBehavior OverwriteExisting = 1;', dump):
        raise ValueError('overwrite enum mismatch')
    source = next((LOCAL/'text-assets').glob('*_C_EquipmentEnhancementScalingInfo.txt'))
    result = dict(version='8.2.0', table='C_EquipmentEnhancementScalingInfo',
        packageSha256=sha(package), binarySha256=sha(binary), sourceSha256=sha(source.read_bytes()),
        metadataSha256=sha((LOCAL/'global-metadata.dat').read_bytes()),
        scriptSha256=sha((LOCAL/'dump/script.json').read_bytes()),
        policy='last-successfully-parsed-row-wins',
        parserRva='0x218994c', parserBytesSha256=sha(code(0x218994c, 0x2cc)),
        evidence=dict(rowOrder='ascending zero-based row index',
            parseGuard='all five TryGetCell results must succeed before assignment',
            assignmentCallRva='0x2189bd0', assignmentTarget='Dictionary<BonusType, object>.set_Item',
            insertionBehavior='OverwriteExisting', insertionBehaviorValue=1,
            checkedInstructionAddresses=[hex(a) for a,_,_ in observations],
            verifiedStringReferences={hex(a):v for a,v in expected_strings.items()}),
        limits=['Bundled table only; server replacement data unknown',
                'Import rejects unsupported or invalid cells rather than emulating every .NET parsing case',
                'This confirms row resolution, not the equipment effect formula or activation'])
    target = ROOT/'reference/tt2/8.2.0/enhancement-parser-evidence.json'
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print('Verified native overwrite policy against pinned APK and 11 instruction checks')

if __name__ == '__main__':
    main()
