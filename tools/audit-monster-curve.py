"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

MonsterModel.GetMonsterBaseHP and GetMonsterBaseGold both call one shared curve, GetMonsterBase,
with parameters read straight out of ServerVarsModel's static block. This records which named
server variables feed each curve and which of them the package actually carries a value for.
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

BASE_HP = 0x2325968
BASE_GOLD = 0x2325ED8
CURVE = 0x2325C4C
# The contiguous block of ServerVarsModel statics the two curves read, by struct offset.
BLOCK = (0x890, 0x9C0)


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
        segment = next(s for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD'
                       and s['p_vaddr'] <= start and start+size <= s['p_vaddr']+s['p_filesz'])
        return binary[start-segment['p_vaddr']+segment['p_offset']:][:size]

    expected_symbols = {BASE_HP: 'MonsterModel$$GetMonsterBaseHP',
                        BASE_GOLD: 'MonsterModel$$GetMonsterBaseGold',
                        CURVE: 'MonsterModel$$GetMonsterBase',
                        0x2279C20: 'HonourModel$$get_ActiveHonourAmount'}
    for address, name in expected_symbols.items():
        if symbols.get(address) != name:
            raise ValueError(f'method identity mismatch: {address:x}')

    machine = Cs(CS_ARCH_ARM64, CS_MODE_ARM)

    def reads(start, size):
        """Struct offsets the function loads from the statics register, and the calls it makes."""
        offsets, calls = set(), []
        for instruction in machine.disasm(code(start, size), start):
            if instruction.mnemonic == 'bl' and instruction.op_str.startswith('#'):
                calls.append(int(instruction.op_str.lstrip('#'), 16))
            found = re.search(r'\[x\d+, #(0x[0-9a-f]+)\]$', instruction.op_str)
            if found and instruction.mnemonic in ('ldr', 'ldur'):
                offsets.add(int(found.group(1), 16))
        return offsets, calls

    hp_offsets, hp_calls = reads(BASE_HP, 0x170)
    gold_offsets, gold_calls = reads(BASE_GOLD, 0xF4)
    for label, calls in (('HP', hp_calls), ('gold', gold_calls)):
        if CURVE not in calls:
            raise ValueError(f'{label} curve no longer calls GetMonsterBase')
    if 0x2279C20 not in hp_calls:
        raise ValueError('HP curve no longer reads the honour amount')

    dump = (LOCAL/'dump/dump.cs').read_text(encoding='utf-8')
    statics = dump.split('public class ServerVarsModel : Singleton<ServerVarsModel>')[1].split('\n\t// Methods')[0]
    fields = {}
    for match in re.finditer(r'\n\tpublic static ([\w<>, ]+) (\w+); // (0x[0-9A-Fa-f]+)', statics):
        fields[int(match.group(3), 16)] = dict(name=match.group(2), type=match.group(1))
    block = {offset: fields[offset] for offset in sorted(fields) if BLOCK[0] <= offset < BLOCK[1]}
    if not block:
        raise ValueError('the monster curve static block moved')

    def named(offsets):
        # A GHDouble is two doubles, so a load can land inside a field rather than on its head.
        heads = sorted(block)
        out = []
        for offset in sorted(offsets):
            head = max((h for h in heads if h <= offset), default=None)
            if head is not None and head in block and offset - head < 0x18 and block[head]['name'] not in out:
                out.append(block[head]['name'])
        return out

    signature = re.search(r'private GHDouble GetMonsterBase\(([^)]*)\)', dump)
    if not signature:
        raise ValueError('GetMonsterBase signature missing')

    bundled = {}
    for name in ('ServerVarsInfo', 'ServerVarOverride'):
        table = json.loads((ROOT/f'reference/tt2/8.2.0/{name}.json').read_text(encoding='utf-8'))
        for record in table['records']:
            bundled.setdefault(record['id'], []).append(name)

    hp_names = named(hp_offsets)
    gold_names = named(gold_offsets)
    parameters = sorted({*hp_names, *gold_names})
    result = dict(
        version='8.2.0',
        packageSha256=sha(package), binarySha256=sha(binary),
        scriptSha256=sha((LOCAL/'dump/script.json').read_bytes()),
        curves=dict(
            health=dict(method='MonsterModel.GetMonsterBaseHP', rva=hex(BASE_HP),
                        bytesSha256=sha(code(BASE_HP, 0x170)), serverVars=hp_names),
            gold=dict(method='MonsterModel.GetMonsterBaseGold', rva=hex(BASE_GOLD),
                      bytesSha256=sha(code(BASE_GOLD, 0xF4)), serverVars=gold_names)),
        sharedCurve=dict(method='MonsterModel.GetMonsterBase', rva=hex(CURVE),
                         signature=signature.group(0)),
        staticBlock=[dict(offset=hex(offset), **block[offset]) for offset in sorted(block)],
        bundledValues={name: bundled.get(name, []) for name in parameters},
        evidence=dict(
            honourOffset='關卡先加上 HonourModel.ActiveHonourAmount × honourStageOffset 才進入曲線',
            shape='兩條曲線共用 GetMonsterBase，參數為 levelOff、transcendenceLevelOff、mult、base1–3 與 expo1–4',
            consequence='怪物血量與金幣曲線的每一個係數都是 [ServerVar]，安裝包沒有帶值'),
        limits=['只證明公式讀哪些具名變數，不證明線上使用的數值',
                'GetMonsterBase 內部如何組合這些參數尚未逐式還原'])
    target = ROOT/'reference/tt2/8.2.0/monster-curve-evidence.json'
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    carried = [name for name in parameters if bundled.get(name)]
    print(f'Verified two curves reading {len(parameters)} named server variables; '
          f'{len(carried)} carried by the package: {", ".join(carried) or "none"}')


if __name__ == '__main__':
    main()
