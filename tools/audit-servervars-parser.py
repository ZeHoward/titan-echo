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

OVERRIDE_PARSER = 0x24a8dcc
VARS_PARSER = 0x24a8f78
AB_SELECTOR = 0x228804c
SCALING_PARSER = 0x23252f8

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
    # ServerVarOverride: guarded row loop, then a dictionary set_Item that overwrites an earlier key.
    override_loop = [
        (0x24a8e6c, 'bl', '#0x2287680'),
        (0x24a8eb4, 'bl', '#0x2288980'),
        (0x24a8eb8, 'cmp', 'w0, #1'),
        (0x24a8ebc, 'b.lt', '#0x24a8f58'),
        (0x24a8ee4, 'mov', 'w22, wzr'),
        (0x24a8f00, 'bl', '#0x2e057ac'),
        (0x24a8f1c, 'bl', '#0x2e057ac'),
        (0x24a8f28, 'bl', '#0x3e48d0c'),
        (0x24a8f2c, 'tbnz', 'w0, #0, #0x24a8f4c'),
        (0x24a8f34, 'cbz', 'x2, #0x24a8f4c'),
        (0x24a8f48, 'bl', '#0x34c7534'),
        (0x24a8f4c, 'add', 'w22, w22, #1'),
        (0x24a8f54, 'b.ne', '#0x24a8ee8'),
    ]
    # ServerVarsInfo: same ascending loop and set_Item, without the blank-key guard.
    vars_loop = [
        (0x24a9080, 'bl', '#0x2287680'),
        (0x24a9130, 'bl', '#0x2288980'),
        (0x24a9158, 'mov', 'w24, wzr'),
        (0x24a9174, 'bl', '#0x2e057ac'),
        (0x24a9190, 'bl', '#0x2e057ac'),
        (0x24a91a4, 'bl', '#0x34c7534'),
        (0x24a91a8, 'add', 'w24, w24, #1'),
        (0x24a91b0, 'b.ne', '#0x24a915c'),
        (0x24a91b8, 'bl', '#0x24a9300'),
    ]
    # TitanScalingInfo is fetched through the A/B selector, so the bundled variant in use is not fixed here.
    scaling_selection = [
        (0x23253b4, 'bl', '#0x228804c'),
        (0x23253e8, 'bl', '#0x256c8d0'),
        (0x22880c8, 'bl', '#0x3e48cf0'),
        (0x22880e4, 'bl', '#0x3e4df04'),
        (0x22880ec, 'csel', 'x20, x21, x19, ne'),
        (0x22880f4, 'bl', '#0x2287768'),
    ]
    observations = override_loop + vars_loop + scaling_selection
    for address, mnemonic, operands in observations:
        instruction(address, mnemonic, operands)
    expected_symbols = {
        OVERRIDE_PARSER: 'ServerVarsModel$$LoadServerVarsOverrideFromInfoDoc',
        VARS_PARSER: 'ServerVarsModel$$LoadServerVarsFromInfoDoc',
        AB_SELECTOR: 'InfoDocs$$GetABTestInfoDoc',
        SCALING_PARSER: 'MonsterModel$$ParseTitanScalingInfo',
        0x2287680: 'InfoDocs$$GetInfoDoc',
        0x2287768: 'InfoDocs$$LoadAsText',
        0x2288980: 'InfoDoc$$GetRowCount',
        0x2e057ac: 'InfoDoc$$TryGetCell<object>',
        0x34c7534: 'System.Collections.Generic.Dictionary<object, object>$$set_Item',
        0x3e48d0c: 'System.String$$IsNullOrWhiteSpace',
        0x3e48cf0: 'System.String$$IsNullOrEmpty',
        0x3e4df04: 'System.String$$Contains',
        0x24a9300: 'ServerVarsModel$$SetVarsFromAttributes',
        0x256c8d0: 'TitanScalingInfo$$Parse',
    }
    for address, name in expected_symbols.items():
        if symbols.get(address) != name:
            raise ValueError(f'method identity mismatch: {address:x}')
    expected_strings = {0x4c1abb0: 'ServerVarsInfo', 0x4c1b000: 'ServerVarOverride', 0x4c1ac30: 'TitanScalingInfo',
        0x4c2e550: 'ServerVarsKey', 0x4c2c840: 'Value', 0x4c2e578: 'iOS', 0x4c2e570: 'Google', 0x4c2e568: 'Amazon'}
    for address, value in expected_strings.items():
        if strings.get(relocations.get(address)) != value:
            raise ValueError(f'string identity mismatch: {address:x}')
    sources = {name: next((LOCAL/'text-assets').glob('*_'+name+'.txt'))
               for name in ('ServerVarsInfo', 'ServerVarOverride')}
    result = dict(version='8.2.0', tables=sorted(sources),
        packageSha256=sha(package), binarySha256=sha(binary),
        metadataSha256=sha((LOCAL/'global-metadata.dat').read_bytes()),
        scriptSha256=sha((LOCAL/'dump/script.json').read_bytes()),
        sourceSha256={name: sha(path.read_bytes()) for name, path in sources.items()},
        policy='last-parsed-row-wins',
        parsers=dict(
            ServerVarOverride=dict(rva=hex(OVERRIDE_PARSER), parserBytesSha256=sha(code(OVERRIDE_PARSER, 0x1a8)),
                keyColumn='ServerVarsKey', valueColumn='Value',
                rowOrder='ascending zero-based row index',
                rowGuard='row skipped when the key is null or whitespace, or the value cell is null',
                assignmentCallRva='0x24a8f48', assignmentTarget='Dictionary<object, object>.set_Item'),
            ServerVarsInfo=dict(rva=hex(VARS_PARSER), parserBytesSha256=sha(code(VARS_PARSER, 0x240)),
                keyColumn='ServerVarsKey', valueColumns=['iOS', 'Google', 'Amazon'],
                valueColumnSelection='one platform column chosen at runtime; the bundled file is not the choice',
                rowOrder='ascending zero-based row index', rowGuard='none observed',
                assignmentCallRva='0x24a91a4', assignmentTarget='Dictionary<object, object>.set_Item',
                appliedBy='ServerVarsModel.SetVarsFromAttributes')),
        abTestSelection=dict(selectorRva=hex(AB_SELECTOR), callerRva=hex(SCALING_PARSER),
            requestedSheet='TitanScalingInfo',
            rule='a runtime-provided A/B sheet name replaces the requested sheet when it is non-empty and contains the requested name',
            loader='InfoDocs.LoadAsText', variantInUse='unknown: the assigned A/B sheet name is not in the package'),
        checkedInstructionAddresses=[hex(a) for a, _, _ in observations],
        verifiedStringReferences={hex(a): v for a, v in expected_strings.items()},
        limits=['Bundled tables only; the live server var payload and A/B assignment are unknown',
                'Row resolution and column identity only; this is not a value, formula or activation check',
                'Import rejects unsupported cells rather than emulating every .NET parsing case'])
    target = ROOT/'reference/tt2/8.2.0/servervars-parser-evidence.json'
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Verified server var row policy and A/B sheet selection against {len(observations)} instruction checks')

if __name__ == '__main__':
    main()
