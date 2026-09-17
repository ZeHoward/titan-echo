"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

What is a hero's damage made of? The engine multiplies the hero's base damage by the level, by the
milestone total from HelperImprovementsInfo, and then by 1.035^(level−1) — a per-level growth rate
carried over from the 7.5 baseline. The package says the first three and not the fourth:
HelperInfo.GetRawDPS is exactly `LevelCurve.GetTotalImprovementByLevel(ascension, level) × level ×
GetBaseDamage(ascension)`, and neither GetRawDPS nor the full GetDPS contains any per-level growth
constant at all — the milestone table is already the whole curve.

This records the call order of both methods, every floating-point literal they load (so "there is no
growth rate in there" is checkable rather than asserted), and the shape of the improvement table.
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

RAW_DPS = 0x22491AC     # HelperInfo.GetRawDPS(int helperLevel, int ascensionLvl)
FULL_DPS = 0x22484E0    # HelperInfo.GetDPS(int helperLevel, int ascensionLvl, bool includeEnhancement)
CURVE_BY_LEVEL = 0x2248828   # LevelCurve.GetTotalImprovementByLevel(int ascension, int level)

# The calls that make up a hero's damage, in the order the two methods make them.
RAW_EXPECTED = ['HelperInfo$$GetLevellingCurve', 'LevelCurve$$GetTotalImprovementByLevel',
                'GHDouble$$op_Implicit', 'GHDouble$$op_Multiply', 'HelperInfo$$GetBaseDamage',
                'GHDouble$$op_Multiply']


def sha(data):
    return hashlib.sha256(data).hexdigest()


def class_block(source, name):
    match = re.search(r'^public class '+re.escape(name)+r'(?=[\s:])[^\n]*\n\{(.*?)^\}', source, re.S | re.M)
    if not match:
        raise ValueError(f'class {name} not found')
    return match.group(1)


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

    expected = {RAW_DPS: 'HelperInfo$$GetRawDPS', FULL_DPS: 'HelperInfo$$GetDPS',
                CURVE_BY_LEVEL: 'LevelCurve$$GetTotalImprovementByLevel'}
    for address, name in expected.items():
        if symbols.get(address) != name:
            raise ValueError(f'method identity mismatch at {address:#x}: {symbols.get(address)!r}')

    def walk(address):
        """The calls a method makes, and every floating-point constant it loads."""
        calls, constants = [], []
        for ins in machine.disasm(body(address), address):
            if ins.mnemonic == 'bl':
                target = int(ins.op_str.lstrip('#'), 16)
                name = symbols.get(target)
                # Il2Cpp runtime helpers (class init, null check) are noise, not part of the formula.
                if name:
                    calls.append(name)
            elif ins.mnemonic == 'fmov' and ', #' in ins.op_str:
                constants.append({'at': hex(ins.address), 'source': 'immediate',
                                  'value': float(ins.op_str.split('#')[1])})
            elif ins.mnemonic == 'ldr' and re.match(r'[ds]\d+, #0x', ins.op_str):
                register, _, literal = ins.op_str.partition(', #')
                where = int(literal, 16)
                width = 8 if register.startswith('d') else 4
                raw = read(where, width)
                value = struct.unpack('<d' if width == 8 else '<f', raw)[0]
                constants.append({'at': hex(ins.address), 'source': 'literal',
                                  'literalRva': hex(where), 'value': value})
        return calls, constants

    raw_calls, raw_constants = walk(RAW_DPS)
    full_calls, full_constants = walk(FULL_DPS)

    named = [call for call in raw_calls if not call.startswith('Singleton')]
    if named != RAW_EXPECTED:
        raise ValueError(f'GetRawDPS changed shape: {named}')

    # The claim worth pinning: no per-level growth rate hides in either method. Anything that is not
    # 0 or 1 would be a coefficient, and there are none.
    suspicious = [c for c in raw_constants + full_constants if c['value'] not in (0.0, 1.0)]
    if suspicious:
        raise ValueError(f'unexpected coefficients in the hero damage path: {suspicious}')

    # The improvement table: how many rows, per ascension, and where the engine's list comes from.
    table = json.loads((ROOT/'reference/tt2/8.2.0/HelperImprovementsInfo.json').read_text(encoding='utf-8'))
    rows = [record['values'] for record in table['records']]
    per_ascension = {}
    for row in rows:
        per_ascension[row['Ascension']] = per_ascension.get(row['Ascension'], 0) + 1
    ascension0 = [row for row in rows if row['Ascension'] == '0']

    curve_fields = re.findall(r'private (?:readonly )?([\w<>, ]+) (\w+); // 0x[0-9A-Fa-f]+',
                              class_block(dump, 'LevelCurve'))

    document = {
        'version': '8.2.0',
        'role': '英雄傷害由哪些因子相乘：原生的呼叫順序、兩個方法載入的每一個浮點常數，'
                '以及成長曲線表的形狀。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': 'HelperInfo.GetRawDPS 就是 '
                   'LevelCurve.GetTotalImprovementByLevel(昇階, 等級) × 等級 × GetBaseDamage(昇階)，'
                   '三個因子相乘，沒有第四項；完整的 GetDPS 在外面再乘武器、全體英雄加成與強化倍率。'
                   '兩個方法載入的浮點常數只有 0 與 1，**沒有任何逐級成長率**——'
                   '里程碑累計倍率本身就是整條曲線。',
        'consequence': '引擎現行的 heroDps 另外乘了 1.035^(等級−1)，這一項在安裝包裡沒有對應來源。'
                       '它是 7.5 基準的產物，且與同為 7.5 近似的怪物血量曲線（18 × 1.32^關卡）配套；'
                       '單獨移除會讓英雄傷害在 1000 級時少 8.4×10^14 倍，直接改變關卡難度，'
                       '因此登記為 table-differs 並保留現值，不在沒有原版怪物曲線的情況下只改一邊。',
        'rawDps': {'method': fact(RAW_DPS), 'calls': named,
                   'formula': 'GetTotalImprovementByLevel(ascension, level) × level × GetBaseDamage(ascension)',
                   'floatConstants': raw_constants},
        'fullDps': {'method': fact(FULL_DPS),
                    'calls': [call for call in full_calls if not call.startswith('Singleton')],
                    'floatConstants': full_constants},
        'levelCurve': {'method': fact(CURVE_BY_LEVEL),
                       'fields': [{'type': kind.strip(), 'name': name} for kind, name in curve_fields],
                       'note': '曲線以 (昇階, 等級) 為鍵保存每一段的增量與累計倍率，'
                               'GetTotalImprovementByLevel 先用 GetLevelIndex 找到該等級落在哪一段，再取累計值。'},
        'improvementTable': {'file': 'HelperImprovementsInfo.json', 'rows': len(rows),
                             'rowsPerAscension': per_ascension,
                             'ascension0Rows': len(ascension0),
                             'ascension0TopLevel': ascension0[-1]['Level'],
                             'ascension0TopMelee': ascension0[-1]['PrecalculatedAmountMelee'],
                             'note': '本專案只實作昇階 0，lib/tt2-data.ts 的 TT2_HERO_MILESTONES '
                                     '就是這張表 Ascension 0 的 PrecalculatedAmount 三欄。'},
        'limits': [
            'GetBaseDamage 依昇階從一個 List<GHDouble> 取值，本專案只用得到昇階 0 的那一格',
            '本表只說明因子與順序；每個因子的數值仍可能被伺服器參數改變',
            '怪物血量與金幣曲線同為 7.5 近似（十個具名 [ServerVar] 在包內都沒有值），'
            '所以「照原生改英雄成長」無法在包內找到對應的難度基準',
        ],
    }
    target = ROOT/'reference/tt2/8.2.0/hero-dps-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Verified GetRawDPS as {len(named)} calls with {len(raw_constants)} float constants, '
          f'GetDPS with {len(full_constants)}; improvement table has {len(rows)} rows across '
          f'{len(per_ascension)} ascensions ({len(ascension0)} at ascension 0)')


if __name__ == '__main__':
    main()
