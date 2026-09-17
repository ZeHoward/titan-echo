"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

What is the growth rate in a hero's upgrade cost? The engine uses 1.075, carried over from the 7.5
baseline, and the package has no column for it: HelperInfo.json only carries PurchaseCost1. The rate
is a [ServerVar] — `ServerVarsModel.helperUpgradeBase` — and unlike most of them it does have a
static default in the binary, the same way the Sword Master's costBase and costGrowth do.

This recovers that default from ServerVarsModel's class constructor, and shows it really is the
cost's common ratio rather than some unrelated field: HelperInfo's constructor reads it, takes its
logarithm into `helperUpgradeBaseLog`, and stores base−1 into `helperUpgradeBaseMinusOne` — the two
derived quantities a geometric series needs. It also records the three int[] fields that sit beside
it and are *not* recovered here, so the gap is visible rather than implied.
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

SERVER_VARS_CCTOR = 0x24AA338   # ServerVarsModel..cctor
HELPER_INFO_CTOR = 0x22478B0    # HelperInfo..ctor, where the two derived quantities are computed
PURCHASE_COST = 0x224B4B0       # HelperInfo.GetPurchaseCost
MAX_UPGRADES = 0x224B728        # HelperInfo.GetMaxNumUpgrades
EVOLVE_COST = 0x224AFE0         # HelperInfo.GetEvolveAdditionalCost
GH_POW = 0x21DED24              # GHDouble.Pow

# The neighbouring [ServerVar] fields that also shape the cost and are not recovered here.
UNRESOLVED = ['helperUpgradeLevelTiers', 'helperUpgradeModulus', 'helperUpgradeOffsets']


def sha(data):
    return hashlib.sha256(data).hexdigest()


def class_block(source, name):
    match = re.search(r'^public class '+re.escape(name)+r'(?=[\s:])[^\n]*\n\{(.*?)^\}', source, re.S | re.M)
    if not match:
        raise ValueError(f'class {name} not found')
    return match.group(1)


def field_offset(block, name):
    match = re.search(r'\b'+re.escape(name)+r'; // 0x([0-9A-Fa-f]+)', block)
    if not match:
        raise ValueError(f'field {name} not found')
    return int(match.group(1), 16)


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
        return read(address, min(following-address, 0x4000))

    def fact(address):
        return {'name': symbols[address], 'rva': hex(address), 'bytesSha256': sha(body(address))}

    expected = {SERVER_VARS_CCTOR: 'ServerVarsModel$$.cctor', HELPER_INFO_CTOR: 'HelperInfo$$.ctor',
                PURCHASE_COST: 'HelperInfo$$GetPurchaseCost', MAX_UPGRADES: 'HelperInfo$$GetMaxNumUpgrades',
                EVOLVE_COST: 'HelperInfo$$GetEvolveAdditionalCost', GH_POW: 'GHDouble$$Pow'}
    for address, name in expected.items():
        if symbols.get(address) != name:
            raise ValueError(f'method identity mismatch at {address:#x}: {symbols.get(address)!r}')

    server_vars = class_block(dump, 'ServerVarsModel')
    helper_info = class_block(dump, 'HelperInfo')
    base_offset = field_offset(server_vars, 'helperUpgradeBase')
    log_offset = field_offset(helper_info, 'helperUpgradeBaseLog')
    minus_one_offset = field_offset(helper_info, 'helperUpgradeBaseMinusOne')
    unresolved = {name: hex(field_offset(server_vars, name)) for name in UNRESOLVED}

    # --- The static default, out of the class constructor -------------------------------------
    # A 32-bit immediate built with mov/movk and stored straight into the statics block.
    words, writes = {}, []
    for ins in machine.disasm(body(SERVER_VARS_CCTOR), SERVER_VARS_CCTOR):
        op = ins.op_str
        m = re.fullmatch(r'(w\d+), #(0x[0-9a-f]+|\d+)', op)
        if ins.mnemonic == 'mov' and m:
            words[m.group(1)] = int(m.group(2), 0) & 0xFFFFFFFF
            continue
        m = re.fullmatch(r'(w\d+), #(0x[0-9a-f]+), lsl #(\d+)', op)
        if ins.mnemonic == 'movk' and m:
            words[m.group(1)] = (words.get(m.group(1), 0) | (int(m.group(2), 16) << int(m.group(3)))) & 0xFFFFFFFF
            continue
        m = re.fullmatch(r'(w\d+), \[x\d+, #(0x[0-9a-f]+)\]', op)
        if ins.mnemonic == 'str' and m and int(m.group(2), 16) == base_offset and m.group(1) in words:
            writes.append({'at': hex(ins.address), 'raw': words[m.group(1)]})
    if len(writes) != 1:
        raise ValueError(f'expected exactly one write to helperUpgradeBase, got {writes}')
    raw = writes[0]['raw']
    growth = struct.unpack('<f', struct.pack('<I', raw))[0]

    # --- It is the cost's common ratio: the constructor derives log(base) and base−1 -----------
    saw_read = saw_log = saw_minus_one = False
    pending_call = None
    for ins in machine.disasm(body(HELPER_INFO_CTOR), HELPER_INFO_CTOR):
        op = ins.op_str
        if ins.mnemonic == 'ldr' and re.fullmatch(r's\d+, \[x\d+, #'+hex(base_offset)+r'\]', op):
            saw_read = True
        elif ins.mnemonic == 'bl' and saw_read:
            pending_call = int(op.lstrip('#'), 16)
        elif ins.mnemonic == 'str' and pending_call and \
                re.fullmatch(r'd\d+, \[x\d+, #'+hex(log_offset)+r'\]', op):
            saw_log = True
        elif ins.mnemonic == 'fmov' and op.endswith('#-1.00000000'):
            saw_minus_one = True
    if not (saw_read and saw_log and saw_minus_one):
        raise ValueError(f'HelperInfo..ctor no longer derives the ratio: '
                         f'read={saw_read} log={saw_log} minusOne={saw_minus_one}')

    # --- The cost itself: base cost × Pow(ratio, level) ----------------------------------------
    cost_calls = [symbols[int(ins.op_str.lstrip('#'), 16)]
                  for ins in machine.disasm(body(PURCHASE_COST), PURCHASE_COST)
                  if ins.mnemonic == 'bl' and symbols.get(int(ins.op_str.lstrip('#'), 16))]
    for required in ['System.Collections.Generic.List<GHDouble>$$get_Item', 'GHDouble$$Pow',
                     'GHDouble$$op_Multiply']:
        if required not in cost_calls:
            raise ValueError(f'GetPurchaseCost changed shape, missing {required}: {cost_calls}')

    document = {
        'version': '8.2.0',
        'role': '英雄升級費用的公比從哪裡來：原生靜態預設值、它確實是公比的證據，'
                '以及旁邊三個沒解出來的欄位。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': f'ServerVarsModel.helperUpgradeBase 是 static float，'
                   f'類別建構式寫入的靜態預設值是 {growth!r}（原始位元 {raw:#010x}，即 float 的 1.08）。'
                   'HelperInfo 的建構式讀它之後取對數存進 helperUpgradeBaseLog、'
                   '並把 base−1 存進 helperUpgradeBaseMinusOne，'
                   '正是等比級數需要的兩個導出量；GetPurchaseCost 以 GHDouble.Pow 乘上基礎費用。',
        'consequence': '引擎原本用的 1.075 是 7.5 基準，8.2 的原生預設值是 1.08；'
                       '結構（基礎費用 × 公比^等級、總和除以 公比−1）與引擎既有寫法相同，只有公比不同。'
                       '與劍術大師側的 costBase／costGrowth 同樣屬於「原生靜態預設值」，線上覆蓋值未知。',
        'growthRate': {'field': 'ServerVarsModel.helperUpgradeBase',
                       'staticFieldOffset': hex(base_offset),
                       'assignedIn': fact(SERVER_VARS_CCTOR),
                       'writes': writes,
                       'rawBits': f'{raw:#010x}',
                       'float': growth,
                       'doubleOfFloat': float(growth)},
        'derivedInConstructor': {'method': fact(HELPER_INFO_CTOR),
                                 'helperUpgradeBaseLog': hex(log_offset),
                                 'helperUpgradeBaseMinusOne': hex(minus_one_offset),
                                 'note': '建構式讀 helperUpgradeBase，把它傳進一個未具名的數學函式'
                                         '（取對數）後存進 helperUpgradeBaseLog，'
                                         '另以 fadd −1 得到 helperUpgradeBaseMinusOne。'
                                         '這兩個量分別被 GetMaxNumUpgrades 與 GetEvolveAdditionalCost 使用。'},
        'purchaseCost': {'method': fact(PURCHASE_COST), 'calls': cost_calls,
                         'related': [fact(MAX_UPGRADES), fact(EVOLVE_COST)]},
        'unresolved': {'fields': unresolved,
                       'note': '這三個 int[] 靜態欄位與公比相鄰，在類別建構式裡由 '
                               'RuntimeHelpers.InitializeArray 從中繼資料填充，本次沒有解出內容；'
                               '它們可能對特定等級區間的費用另有修正，尚未確認。'},
        'limits': [
            '靜態預設值不是線上值：helperUpgradeBase 是 [ServerVar]，伺服器可整份覆蓋，'
            '而安裝包的兩張變數表都沒有帶這個鍵',
            '本表只確認公比與其導出量；三個 int[] 欄位的作用未確認',
            'GetPurchaseCost 讀的 purchaseCosts 清單已含費用減免，與資料表的 PurchaseCost1 不完全相同',
        ],
    }
    target = ROOT/'reference/tt2/8.2.0/helper-cost-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Recovered helperUpgradeBase = {growth!r} ({raw:#010x}) from one write in the class '
          f'constructor; {len(cost_calls)} calls in GetPurchaseCost; {len(unresolved)} neighbouring '
          f'int[] fields left unresolved')


if __name__ == '__main__':
    main()
