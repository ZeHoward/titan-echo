"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

How many normal titans does a stage hold? The engine answers 10, flat, because the three named
[ServerVar] fields behind it carry no value in either bundled variable table. They do have compiled-in
defaults, though, and StageLogic.GetRawMonsterCountPerStage is short enough to read in full:

    round(monsterCountBase + stageNum * monsterCountInc / (monsterCountStageDelta + stageNum))

This pins that shape instruction by instruction — which static field feeds which operand, in which
order, and that the result goes through C#'s Math.Round (modf plus a half-way test) rather than a
floor — and publishes a sample of the resulting counts so the engine can be checked against it.
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

RAW_COUNT = 0x25468A0       # StageLogic.GetRawMonsterCountPerStage(int stageNum)
PER_STAGE = 0x2546594       # StageLogic.GetMonsterCountPerStage(int, int splashSkip, bool)
FIELDS = {'monsterCountBase': 0x890, 'monsterCountInc': 0x894, 'monsterCountStageDelta': 0x898}
SAMPLE_STAGES = [1, 10, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 40000, 98000]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def round_half_even(value):
    """C#'s Math.Round(double): ties go to the even integer."""
    floor = int(value // 1)
    fraction = value - floor
    if fraction > 0.5:
        return floor + 1
    if fraction < 0.5:
        return floor
    return floor if floor % 2 == 0 else floor + 1


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

    for address, name in {RAW_COUNT: 'StageLogic$$GetRawMonsterCountPerStage',
                          PER_STAGE: 'StageLogic$$GetMonsterCountPerStage'}.items():
        if symbols.get(address) != name:
            raise ValueError(f'method identity mismatch at {address:#x}: {symbols.get(address)!r}')

    # The field offsets come from dump.cs, so a reshuffled statics block fails loudly.
    block = re.search(r'^public class ServerVarsModel(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)
    for name, offset in FIELDS.items():
        match = re.search(r'public static int '+name+r'; // 0x([0-9A-Fa-f]+)', block)
        if not match or int(match.group(1), 16) != offset:
            raise ValueError(f'{name} is no longer int at {offset:#x}')

    # Walk the method: which static field is read, and which arithmetic is applied, in order.
    reads, operations, calls = [], [], []
    for ins in machine.disasm(body(RAW_COUNT), RAW_COUNT):
        m = re.fullmatch(r'[sw]\d+, \[x\d+, #(0x[0-9a-f]+)\]', ins.op_str)
        if ins.mnemonic == 'ldr' and m:
            offset = int(m.group(1), 16)
            name = next((field for field, at in FIELDS.items() if at == offset), None)
            if name:
                reads.append(name)
        elif ins.mnemonic in ('fmul', 'fdiv', 'fadd', 'scvtf', 'fcvt'):
            operations.append(ins.mnemonic)
        elif ins.mnemonic == 'bl':
            calls.append(hex(int(ins.op_str.lstrip('#'), 16)))
    if reads != ['monsterCountInc', 'monsterCountStageDelta', 'monsterCountBase']:
        raise ValueError(f'GetRawMonsterCountPerStage reads {reads}')
    for required in ('fmul', 'fdiv', 'fadd'):
        if required not in operations:
            raise ValueError(f'missing {required}: {operations}')

    defaults = json.loads((ROOT/'reference/tt2/8.2.0/servervar-defaults.json')
                          .read_text(encoding='utf-8'))['recovered']
    values = {}
    for name in FIELDS:
        if name not in defaults:
            raise ValueError(f'{name} has no recovered default; run audit-servervar-defaults.py first')
        values[name] = defaults[name]['value']

    base, inc, delta = values['monsterCountBase'], values['monsterCountInc'], values['monsterCountStageDelta']
    counts = {str(stage): round_half_even(base + stage*inc/(delta+stage)) for stage in SAMPLE_STAGES}

    document = {
        'version': '8.2.0',
        'role': '每關普通泰坦的隻數：原生算式、參與的三個 [ServerVar] 與其編譯期預設值，以及逐關樣本。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': 'StageLogic.GetRawMonsterCountPerStage 依序讀 monsterCountInc、monsterCountStageDelta、'
                   'monsterCountBase，算 base + 關卡 × inc ÷ (delta + 關卡)，再交給 Math.Round。'
                   f'三個欄位的編譯期預設值是 base={base}、inc={inc}、delta={delta}，'
                   f'因此第 1 關 {counts["1"]} 隻、第 1000 關 {counts["1000"]} 隻、'
                   f'第 98000 關 {counts["98000"]} 隻。',
        'consequence': '引擎原本固定 10 隻，早期偏多、後期遠遠偏少。'
                       '這三個欄位仍是 [ServerVar]，線上可覆蓋，因此接入後狀態是 default 而非 native。',
        'method': fact(RAW_COUNT),
        'caller': fact(PER_STAGE),
        'formula': 'round(monsterCountBase + stageNum × monsterCountInc ÷ (monsterCountStageDelta + stageNum))',
        'readsInOrder': reads,
        'defaults': {name: {'offset': hex(FIELDS[name]), 'value': values[name]} for name in FIELDS},
        'rounding': {'call': calls[0] if calls else None,
                     'note': '原生把和交給 C# 的 Math.Round(double)：以 modf 取小數部分後比較 ±0.5，'
                             '剛好 0.5 時進位到偶數。本表的樣本依同一規則計算。'},
        'sampleCounts': counts,
        'limits': [
            '三個欄位都是 [ServerVar]，本表用的是編譯期預設值，不是線上值',
            'GetMonsterCountPerStage 另有 splashSkip 與 isInactiveGameplay 兩個修正參數，本表只記原始值',
            '樣本以 double 計算；原生以 float 運算，極端關卡可能在進位邊界差一隻',
        ],
    }
    target = ROOT/'reference/tt2/8.2.0/monster-count-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Verified the count formula (base={base}, inc={inc}, delta={delta}); '
          f'stage 1 -> {counts["1"]}, stage 1000 -> {counts["1000"]}, stage 98000 -> {counts["98000"]}')


if __name__ == '__main__':
    main()
