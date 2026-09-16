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

PARSER = 0x211299C  # AchievementModel.Initialize


def sha(data):
    return hashlib.sha256(data).hexdigest()


def enum_members(text, name):
    body = text.split(f'public enum {name} ')[1].split('}')[0]
    rows = re.findall(r'public const ' + name + r' (\w+) = (-?\d+);', body)
    if not rows or len(dict(rows)) != len(rows):
        raise ValueError(f'missing or duplicate native {name} members')
    return {value: member for member, value in rows}


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
        segment = next(s for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD'
                       and s['p_vaddr'] <= start and start+size <= s['p_vaddr']+s['p_filesz'])
        return binary[start-segment['p_vaddr']+segment['p_offset']:][:size]

    def instruction(address, mnemonic, operands):
        actual = next(Cs(CS_ARCH_ARM64, CS_MODE_ARM).disasm(code(address, 4), address))
        if (actual.mnemonic, actual.op_str) != (mnemonic, operands):
            raise ValueError(f'instruction changed at {address:x}')

    # The lifetime table is read first, then the daily one, from the same method.
    observations = [
        (0x2112b54, 'bl', '#0x2287680'),   # InfoDocs.GetInfoDoc("AchievementInfo")
        (0x2112b6c, 'bl', '#0x2288980'),   # row count
        (0x2112bb4, 'bl', '#0x2e051bc'),   # Type as an enum cell
        (0x2112be8, 'bl', '#0x2e057ac'),   # Requirement as a string cell
        (0x2112c14, 'bl', '#0x26106b0'),   # ...parsed into a list of GHDouble
        (0x2112c40, 'bl', '#0x2e057ac'),   # Reward as a string cell
        (0x2112c50, 'bl', '#0x2610a10'),   # ...parsed into a list of int
        (0x2112c80, 'bl', '#0x2111218'),   # AchievementInfo constructed
        (0x2112cb8, 'bl', '#0x3481b74'),   # inserted by type
        (0x2112d20, 'bl', '#0x2287680'),   # InfoDocs.GetInfoDoc("DailyAchievementInfo")
        (0x2112d70, 'bl', '#0x2e051bc'),   # Type as an enum cell
        (0x2112d9c, 'bl', '#0x2e057ac'),   # RewardString as a string cell
        (0x2112dd8, 'bl', '#0x2e06b7c'),   # IsActive as a bool cell with a default
        (0x2112e08, 'bl', '#0x2e06d20'),   # Requirement as an int cell with a default
        (0x2112e38, 'bl', '#0x243335c'),   # RewardClass built from the reward string
        (0x2112e94, 'bl', '#0x3481b74'),   # inserted by type
    ]
    for address, mnemonic, operands in observations:
        instruction(address, mnemonic, operands)

    expected_symbols = {
        PARSER: 'AchievementModel$$Initialize',
        0x2287680: 'InfoDocs$$GetInfoDoc', 0x2288980: 'InfoDoc$$GetRowCount',
        0x2e051bc: 'InfoDoc$$TryGetCell<Int32Enum>', 0x2e057ac: 'InfoDoc$$TryGetCell<object>',
        0x2e06b7c: 'InfoDoc$$TryGetCellOrDefault<bool>', 0x2e06d20: 'InfoDoc$$TryGetCellOrDefault<int>',
        0x26106b0: 'GHTool$$ParseStringToListGHDouble', 0x2610a10: 'GHTool$$ParseStringToListInt',
        0x2111218: 'AchievementInfo$$.ctor', 0x243335c: 'RewardClass$$.ctor',
        0x3481b74: 'System.Collections.Generic.Dictionary<Int32Enum, object>$$set_Item',
    }
    for address, name in expected_symbols.items():
        if symbols.get(address) != name:
            raise ValueError(f'method identity mismatch: {address:x}')

    expected_strings = {0x4c14b20: 'AchievementInfo', 0x4c14b78: 'DailyAchievementInfo',
                        0x4c0ec58: 'Type', 0x4c14b68: 'Requirement', 0x4c14b70: 'Reward',
                        0x4c0ec98: 'IsActive', 0x4c14b80: 'RewardString'}
    for address, value in expected_strings.items():
        if strings.get(relocations.get(address)) != value:
            raise ValueError(f'string identity mismatch: {address:x}')

    dump = (LOCAL/'dump/dump.cs').read_text(encoding='utf-8')
    fields = dump.split('public class AchievementInfo ')[1].split('// Methods')[0]
    for field in ('AchievementType <type>k__BackingField', 'List<GHDouble> <requirement>k__BackingField',
                  'List<int> <diamondReward>k__BackingField', 'int <tier>k__BackingField',
                  'GHDouble <progress>k__BackingField', 'AchievementStatus <status>k__BackingField'):
        if field not in fields:
            raise ValueError(f'achievement field missing: {field}')
    types = enum_members(dump, 'AchievementType')
    daily_types = enum_members(dump, 'DailyAchievementType')
    statuses = enum_members(dump, 'AchievementStatus')

    sheet = json.loads((ROOT/'reference/tt2/8.2.0/AchievementInfo.json').read_text(encoding='utf-8'))
    listed = [record['values']['Type'] for record in sheet['records']]
    missing = [name for name in types.values() if name not in listed]

    result = dict(
        version='8.2.0', table='AchievementInfo',
        packageSha256=sha(package), binarySha256=sha(binary),
        metadataSha256=sha((LOCAL/'global-metadata.dat').read_bytes()),
        scriptSha256=sha((LOCAL/'dump/script.json').read_bytes()),
        parser='AchievementModel.Initialize', parserRva=hex(PARSER),
        parserBytesSha256=sha(code(PARSER, 0x520)),
        columnsRead=dict(AchievementInfo=['Type', 'Requirement', 'Reward'],
                         DailyAchievementInfo=['Type', 'RewardString', 'IsActive', 'Requirement']),
        evidence=dict(
            requirementType='List<GHDouble> via GHTool.ParseStringToListGHDouble',
            rewardType='List<int> via GHTool.ParseStringToListInt',
            rewardField='diamondReward',
            rewardCurrency='diamonds, named by the field the parsed list is stored in',
            dailyRewardType='RewardClass built from the RewardString cell',
            insertion='Dictionary<AchievementType, AchievementInfo>.set_Item keyed by type',
            structFields=['type', 'requirement', 'diamondReward', 'tier', 'progress', 'status'],
            statuses=[statuses[key] for key in sorted(statuses, key=int)],
            checkedInstructionAddresses=[hex(a) for a, _, _ in observations],
            verifiedStringReferences={hex(a): v for a, v in expected_strings.items()}),
        achievementTypes={key: types[key] for key in sorted(types, key=int)},
        dailyAchievementTypes={key: daily_types[key] for key in sorted(daily_types, key=int)},
        typesWithoutSheetRow=missing,
        limits=['Column identity, cell types and insertion only; what counts as progress for a type is not proven here',
                'Bundled sheet only; a live server may replace these rows or their progress'])
    target = ROOT/'reference/tt2/8.2.0/achievement-parser-evidence.json'
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Verified achievement columns against {len(observations)} instruction checks, '
          f'{len(types)} types, {len(missing)} without a sheet row')


if __name__ == '__main__':
    main()
