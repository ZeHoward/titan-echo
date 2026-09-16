"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

TutorialEventModel keeps its own tap counter, so a TapCount objective counts taps since the step
began, while the other three objectives read absolute values from their own models. That split is
what this records, along with the objective test itself.
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

IS_MET = 0x25DB344
PROGRESS = 0x25DB37C


def sha(data):
    return hashlib.sha256(data).hexdigest()


def enum_members(text, name):
    body = text.split(f'public enum {name} ')[1].split('}')[0]
    rows = re.findall(r'public const ' + re.escape(name) + r' (\w+) = (-?\d+);', body)
    if not rows:
        raise ValueError(f'missing native {name} members')
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
    elf = ELFFile(io.BytesIO(binary))

    def code(start, size):
        segment = next(s for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD'
                       and s['p_vaddr'] <= start and start+size <= s['p_vaddr']+s['p_filesz'])
        return binary[start-segment['p_vaddr']+segment['p_offset']:][:size]

    expected_symbols = {IS_MET: 'TutorialEventModel$$IsObjectiveMet',
                        PROGRESS: 'TutorialEventModel$$GetCurrentProgress',
                        0x25DB2BC: 'TutorialEventModel$$GetCurrentEventInfo',
                        0x2256F50: 'HelperModel$$GetUnlockedHelpersCount'}
    for address, name in expected_symbols.items():
        if symbols.get(address) != name:
            raise ValueError(f'method identity mismatch: {address:x}')

    machine = Cs(CS_ARCH_ARM64, CS_MODE_ARM)
    met = list(machine.disasm(code(IS_MET, 0x38), IS_MET))
    tail = [(i.mnemonic, i.op_str) for i in met[-8:]]
    # progress >= ObjectiveAmount, where ObjectiveAmount sits at 0x30 of the info object.
    for expected in [('ldr', 'w8, [x20, #0x30]'), ('cmp', 'w0, w8'), ('cset', 'w0, ge')]:
        if expected not in tail:
            raise ValueError(f'objective test changed: {expected} not found')
    progress = list(machine.disasm(code(PROGRESS, 0x160), PROGRESS))
    text = [(i.mnemonic, i.op_str) for i in progress]
    if ('ldr', 'w0, [x19, #0x38]') not in text:
        raise ValueError('tap progress no longer reads the model tap counter')
    if not any(i.mnemonic == 'b' and i.op_str == '#0x2256f50' for i in progress):
        raise ValueError('helper progress no longer reads the unlocked helper count')

    dump = (LOCAL/'dump/dump.cs').read_text(encoding='utf-8')
    objectives = enum_members(dump, 'TutorialEventInfo.ObjectiveType')
    info = dump.split('public class TutorialEventInfo ')[1].split('// Properties')[0]
    for field in ('int <Index>k__BackingField', 'double <GoldReward>k__BackingField',
                  'bool <ShowProgress>k__BackingField', 'int <ObjectiveAmount>k__BackingField',
                  'TutorialEventInfo.ObjectiveType <Objective>k__BackingField'):
        if field not in info:
            raise ValueError(f'tutorial field missing: {field}')
    model = dump.split('public class TutorialEventModel : Singleton<TutorialEventModel>')[1].split('// Methods')[0]
    for field in ('private int CurrentTapCount;', 'private int CurrentEventIndex;', 'private bool AllComplete;'):
        if field not in model:
            raise ValueError(f'tutorial model field missing: {field}')

    reference = ROOT/'reference/tt2/8.2.0'
    variants = {}
    for name in ('TutorialEventInfo', 'TutorialEventInfo_A', 'TutorialEventInfo_B'):
        rows = json.loads((reference/f'{name}.json').read_text(encoding='utf-8'))['records']
        variants[name] = [row['values']['Objective'] for row in rows]
    base = variants['TutorialEventInfo']
    differing = {name: [i for i, value in enumerate(rows) if value != base[i]]
                 for name, rows in variants.items() if name != 'TutorialEventInfo'}

    result = dict(
        version='8.2.0', table='TutorialEventInfo',
        packageSha256=sha(package), binarySha256=sha(binary),
        scriptSha256=sha((LOCAL/'dump/script.json').read_bytes()),
        objectiveTest=dict(method='TutorialEventModel.IsObjectiveMet', rva=hex(IS_MET),
                           bytesSha256=sha(code(IS_MET, 0x38)),
                           rule='GetCurrentProgress() >= TutorialEventInfo.ObjectiveAmount'),
        progress=dict(method='TutorialEventModel.GetCurrentProgress', rva=hex(PROGRESS),
                      bytesSha256=sha(code(PROGRESS, 0x160)),
                      sources={
                          'TapCount': 'TutorialEventModel.CurrentTapCount，模型自己的計數，換步時歸零',
                          'SwordMasterLevel': '玩家目前等級，絕對值',
                          'ReachStage': '目前關卡，絕對值',
                          'UnlockHelperCount': 'HelperModel.GetUnlockedHelpersCount()，絕對值'}),
        objectiveTypes={key: objectives[key] for key in sorted(objectives, key=int)},
        modelState=['CurrentTapCount', 'CurrentEventIndex', 'AllComplete'],
        infoFields=['Index', 'GoldReward', 'ShowProgress', 'Objective', 'ObjectiveAmount', 'displayString',
                    'shouldModifyString'],
        variants=dict(rows=len(base), objectivesDifferingFromBase=differing),
        limits=['只證明目標判定與進度來源，不證明每一步的觸發時機或畫面指引',
                '安裝包另有 A／B 變體，執行期採用哪一份由伺服器指派'])
    (reference/'tutorial-evidence.json').write_text(
        json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Verified the tutorial objective test and {len(objectives)} objective types; '
          f'variant A differs on {len(differing["TutorialEventInfo_A"])} rows, '
          f'B on {len(differing["TutorialEventInfo_B"])}')


if __name__ == '__main__':
    main()
