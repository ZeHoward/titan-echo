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

PARSER = 0x2137a4c

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
        return binary[start-segment['p_vaddr']+segment['p_offset']:][:size]
    def instruction(address, mnemonic, operands):
        actual = next(Cs(CS_ARCH_ARM64, CS_MODE_ARM).disasm(code(address, 4), address))
        if (actual.mnemonic, actual.op_str) != (mnemonic, operands):
            raise ValueError(f'instruction changed at {address:x}')
    # One row reads four integer cells and one enum cell, then adds the row by day number.
    observations = [
        (0x2137b54, 'bl', '#0x2287680'),
        (0x2137b64, 'bl', '#0x2288980'),
        (0x2137bcc, 'bl', '#0x2e04bcc'),
        (0x2137c00, 'bl', '#0x2e051bc'),
        (0x2137c1c, 'bl', '#0x2e04bcc'),
        (0x2137c38, 'bl', '#0x2e04bcc'),
        (0x2137c54, 'bl', '#0x2e04bcc'),
        (0x2137c80, 'bl', '#0x34374d4'),
    ]
    for address, mnemonic, operands in observations:
        instruction(address, mnemonic, operands)
    expected_symbols = {PARSER: 'DailyRewardModel$$ParseInfoDocs',
        0x2287680: 'InfoDocs$$GetInfoDoc', 0x2288980: 'InfoDoc$$GetRowCount',
        0x2e04bcc: 'InfoDoc$$TryGetCell<int>', 0x2e051bc: 'InfoDoc$$TryGetCell<Int32Enum>',
        0x34374d4: 'System.Collections.Generic.Dictionary<int, DailyRewardInfo>$$Add'}
    for address, name in expected_symbols.items():
        if symbols.get(address) != name:
            raise ValueError(f'method identity mismatch: {address:x}')
    expected_strings = {0x4c15d20: 'DailyRewardsInfo', 0x4c15d48: 'Day', 0x4c15d38: 'Count',
        0x4c15d50: 'HolidayCurrency', 0x4c15d40: 'AnniversaryMinigameCurrency'}
    for address, value in expected_strings.items():
        if strings.get(relocations.get(address)) != value:
            raise ValueError(f'string identity mismatch: {address:x}')
    dump = (LOCAL/'dump/dump.cs').read_text(encoding='utf-8')
    if 'public struct DailyRewardInfo' not in dump:
        raise ValueError('daily reward struct missing')
    fields = dump.split('public struct DailyRewardInfo')[1].split('// Methods')[0]
    for field in ('DailyRewardPrizeType type;', 'int amount;', 'int dayNumber;',
                  'int holidayCurrency;', 'int anniversaryMinigameCurrency;'):
        if field not in fields:
            raise ValueError(f'daily reward field missing: {field}')
    if 'Reward' in fields.replace('DailyRewardPrizeType', ''):
        raise ValueError('daily reward struct unexpectedly mentions a reward string')
    source = next((LOCAL/'text-assets').glob('*_DailyRewardsInfo.txt'))
    result = dict(version='8.2.0', table='DailyRewardsInfo',
        packageSha256=sha(package), binarySha256=sha(binary), sourceSha256=sha(source.read_bytes()),
        metadataSha256=sha((LOCAL/'global-metadata.dat').read_bytes()),
        scriptSha256=sha((LOCAL/'dump/script.json').read_bytes()),
        parserRva=hex(PARSER), parserBytesSha256=sha(code(PARSER, 0x2c0)),
        columnsRead=['Day', 'RewardType', 'Count', 'HolidayCurrency', 'AnniversaryMinigameCurrency'],
        columnsIgnored=['Reward'],
        evidence=dict(cellsPerRow=5, enumCell='RewardType read as Int32Enum',
            amountColumn='Count', insertion='Dictionary<int, DailyRewardInfo>.Add keyed by day',
            structFields=['type', 'amount', 'dayNumber', 'holidayCurrency', 'anniversaryMinigameCurrency'],
            consequence='the Reward string column is not read, so Count is the amount the client uses',
            checkedInstructionAddresses=[hex(a) for a, _, _ in observations],
            verifiedStringReferences={hex(a): v for a, v in expected_strings.items()}),
        limits=['Column identity and row insertion only; what an amount means per reward type is not proven here',
                'Bundled sheet only; a live server may replace these rows'])
    target = ROOT/'reference/tt2/8.2.0/daily-rewards-parser-evidence.json'
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Verified daily reward columns against {len(observations)} instruction checks')

if __name__ == '__main__':
    main()
