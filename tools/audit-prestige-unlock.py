"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

The register said the 60-stage prestige threshold was a 7.5 baseline and that the package had no
matching field. It does have one: [ServerVar] minimumPrestigeStage, whose compiled-in default is
exactly 60. Finding it took searching by instruction encoding rather than by name — an
`ldr Wt, [Xn, #0xbec]` is fixed except for its two register fields, so a masked scan over the image
finds every reader. There are three, and the one that matters is the tail of GetPrestigeStage:

    CanPrestige()      = 目前關卡 >= GetPrestigeStage()
    GetPrestigeStage() = Math.Max(floor(prestigeMsPercentRequirement * (基準 − advancedStart)
                                        + advancedStart),
                                  minimumPrestigeStage)

So 60 is the floor of the requirement, which is what the engine uses it as. The multiplier in front
of it is not implemented: the engine lets a player prestige at any time once 60 is reached, while
the native requirement climbs to half of the highest stage they have prestiged at.
"""
import bisect
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

CAN_PRESTIGE = 0x23F9264      # PrestigeModel.CanPrestige()
PRESTIGE_STAGE = 0x23F9304    # PrestigeModel.GetPrestigeStage()
ADVANCED_START = 0x23FE940    # PrestigeModel.GetAdvancedStartNextStage()
MATH_MAX = 0x3FCC0F4          # System.Math.Max(int, int)
NAMES = {CAN_PRESTIGE: 'PrestigeModel$$CanPrestige', PRESTIGE_STAGE: 'PrestigeModel$$GetPrestigeStage',
         ADVANCED_START: 'PrestigeModel$$GetAdvancedStartNextStage'}
VARS = {'minimumPrestigeStage': 0xBEC, 'prestigeMsPercentRequirement': 0xBE8,
        'endgameMinPrestigeReqInc': 0xB0}
ENGINE_THRESHOLD = 60


def sha(data):
    return hashlib.sha256(data).hexdigest()


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

    def instructions(address):
        return list(machine.disasm(body(address), address))

    def fact(address):
        return {'name': symbols[address], 'rva': hex(address), 'bytesSha256': sha(body(address))}

    for address, name in NAMES.items():
        if symbols.get(address) != name:
            raise ValueError(f'method identity mismatch at {address:#x}: {symbols.get(address)!r}')
    if 'Math$$Max' not in symbols.get(MATH_MAX, ''):
        raise ValueError(f'{MATH_MAX:#x} is not System.Math.Max: {symbols.get(MATH_MAX)!r}')

    variables = re.search(r'^public class ServerVarsModel(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)
    for name, offset in VARS.items():
        match = re.search(r'public static \S+ '+name+r'; // 0x([0-9A-Fa-f]+)', variables)
        if not match or int(match.group(1), 16) != offset:
            raise ValueError(f'{name} is no longer at {offset:#x}')

    # Every reader of minimumPrestigeStage, found by the fixed instruction encoding:
    # LDR Wt, [Xn, #imm12*4] is 1011_1001_01 imm12 Rn Rt, so only the register fields vary.
    want = 0xB9400000 | ((VARS['minimumPrestigeStage']//4) << 10)
    readers = []
    for segment in elf.iter_segments():
        if segment['p_type'] != 'PT_LOAD' or not segment['p_filesz']:
            continue
        data, virtual = segment.data(), segment['p_vaddr']
        for position in range(0, len(data)-3, 4):
            word, = struct.unpack_from('<I', data, position)
            if word & 0xFFFFFC00 != want:
                continue
            address = virtual+position
            index = bisect.bisect_right(starts, address)-1
            readers.append({'method': symbols.get(starts[index], '?') if index >= 0 else '?',
                            'at': hex(address)})
    if not any(reader['method'] == NAMES[PRESTIGE_STAGE] for reader in readers):
        raise ValueError('GetPrestigeStage no longer reads minimumPrestigeStage')

    # CanPrestige is a single comparison against GetPrestigeStage.
    can = instructions(CAN_PRESTIGE)
    can_calls = [symbols.get(int(i.op_str.lstrip('#'), 16), '') for i in can
                 if i.mnemonic in ('bl', 'b') and i.op_str.startswith('#')]
    if NAMES[PRESTIGE_STAGE] not in can_calls:
        raise ValueError('CanPrestige no longer calls GetPrestigeStage')
    if not any(i.mnemonic == 'cset' and i.op_str.endswith('ge') for i in can):
        raise ValueError('CanPrestige no longer ends in a >= test')

    # GetPrestigeStage ends by flooring a scaled stage and taking Math.Max with the minimum.
    listing = instructions(PRESTIGE_STAGE)
    text = '\n'.join(f'{i.mnemonic} {i.op_str}' for i in listing)
    for needed, why in ((r'ldr s\d+, \[x\d+, #0xbe8\]', 'the prestigeMsPercentRequirement load'),
                        (r'fmul s\d+, s\d+, s\d+', 'the multiply by it'),
                        (r'fadd s\d+, s\d+, s\d+', 'adding the advanced start back'),
                        (r'frintm s\d+, s\d+', 'the floor'),
                        (r'ldr w1, \[x\d+, #0xbec\]', 'minimumPrestigeStage as the Max argument')):
        if not re.search(needed, text):
            raise ValueError(f'GetPrestigeStage no longer contains {why}')
    tail = [i for i in listing if i.mnemonic in ('b', 'bl') and i.op_str.startswith('#')
            and int(i.op_str.lstrip('#'), 16) == MATH_MAX]
    if not tail:
        raise ValueError('GetPrestigeStage no longer ends in Math.Max')
    # The Max that takes the minimum is the tail call, i.e. its result is the return value.
    minimum_load = next(i for i in listing if re.fullmatch(r'ldr w1, \[x\d+, #0xbec\]', f'{i.mnemonic} {i.op_str}'))
    final = tail[-1]
    if not (final.address > minimum_load.address and final.mnemonic == 'b'):
        raise ValueError('minimumPrestigeStage is no longer the argument of the final Math.Max')
    advanced_calls = [symbols.get(int(i.op_str.lstrip('#'), 16), '') for i in listing
                      if i.mnemonic == 'bl' and i.op_str.startswith('#')]
    if NAMES[ADVANCED_START] not in advanced_calls:
        raise ValueError('GetPrestigeStage no longer consults GetAdvancedStartNextStage')

    defaults = json.loads((ROOT/'reference/tt2/8.2.0/servervar-defaults.json')
                          .read_text(encoding='utf-8'))['recovered']
    values = {}
    for name in VARS:
        if name not in defaults:
            raise ValueError(f'{name} has no recovered default; run audit-servervar-defaults.py first')
        values[name] = defaults[name]['value']
    if values['minimumPrestigeStage'] != ENGINE_THRESHOLD:
        raise ValueError(f'minimumPrestigeStage is {values["minimumPrestigeStage"]}, '
                         f'engine uses {ENGINE_THRESHOLD}')

    percent = values['prestigeMsPercentRequirement']
    document = {
        'version': '8.2.0',
        'role': '蛻變開放門檻的原生來源：第 60 關出自哪個欄位，以及原生在它之上還有哪一層。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': f'第 60 關不是 7.5 留下的猜測：[ServerVar] minimumPrestigeStage 的編譯期預設值就是 '
                   f'{values["minimumPrestigeStage"]}，而且它正是 PrestigeModel.GetPrestigeStage 結尾那個 '
                   f'System.Math.Max 的第二個引數，也就是「這次蛻變需要打到第幾關」的下限；'
                   f'CanPrestige 只是拿目前關卡和它比 >=。'
                   f'先前登記寫「安裝包未見對應的蛻變開放關卡欄位」，那是沒找到名字——'
                   f'這次改以指令編碼掃描（ldr Wt,[Xn,#0xbec] 除了兩個暫存器欄位以外完全固定）'
                   f'才找到全部 {len(readers)} 個讀取點。',
        'consequence': f'引擎散在三處的 best >= {ENGINE_THRESHOLD} 由 baseline-75 升為 default；'
                       f'但原生的門檻並非固定 {ENGINE_THRESHOLD}，上面還有一層乘數，那一層本專案沒有實作。',
        'methods': {'canPrestige': fact(CAN_PRESTIGE), 'prestigeStage': fact(PRESTIGE_STAGE),
                    'advancedStart': fact(ADVANCED_START)},
        'threshold': {
            'field': 'ServerVarsModel.minimumPrestigeStage',
            'offset': hex(VARS['minimumPrestigeStage']),
            'value': values['minimumPrestigeStage'],
            'role': 'GetPrestigeStage 尾端 System.Math.Max 的第二個引數，回傳值即為所需關卡',
            'readers': readers,
            'note': f'引擎在 relicGain、discover 與 prestige 三處都寫 best >= {ENGINE_THRESHOLD}，'
                    f'數字與原生下限相同。它是 [ServerVar]，線上可覆蓋，所以狀態是 default 而非 native。',
        },
        'notImplemented': {
            'percentRequirement': {
                'field': 'ServerVarsModel.prestigeMsPercentRequirement',
                'offset': hex(VARS['prestigeMsPercentRequirement']),
                'value': percent,
                'formula': 'GetPrestigeStage = Math.Max(floor(prestigeMsPercentRequirement × '
                           '(基準關卡 − GetAdvancedStartNextStage()) + GetAdvancedStartNextStage()), '
                           'minimumPrestigeStage)',
                'note': f'基準關卡取自 PrestigeModel.maxPrestigeStageCount（歷史最高蛻變關卡），'
                        f'係數的編譯期預設值是 float {percent}，也就是**要推到歷史最高的一半才能再蛻變**。'
                        f'引擎沒有這一層：只要歷史最高到過 {ENGINE_THRESHOLD}，任何時候都能蛻變。'
                        f'第一次蛻變前兩者等價，都是第 {ENGINE_THRESHOLD} 關。',
            },
            'endgameFloor': {
                'field': 'ServerVarsModel.endgameMinPrestigeReqInc',
                'value': values['endgameMinPrestigeReqInc'],
                'note': 'EndgameModel.IsInEndgame 為真時，基準與進階起點的差額還會先與這個值取 Max；'
                        '末日紀元本專案未實作。',
            },
            'advancedStart': {
                'method': symbols[ADVANCED_START],
                'note': 'GetAdvancedStartNextStage 是蛻變後的起始關卡（高等玩家不從第 1 關開始），'
                        '在上式中同時被減去又加回。本專案蛻變一律回到第 1 關，該方法未逐指令讀完。',
            },
        },
        'limits': [
            'minimumPrestigeStage 與 prestigeMsPercentRequirement 都是 [ServerVar]，'
            '本表用的是編譯期預設值，不是線上值',
            'CanPrestige 比較的左運算元是從一個 Singleton 讀出的 ObscuredInt，'
            '未確認它是目前關卡還是別的關卡欄位',
            'GetPrestigeStage 前半還有一條由某個 bool 開關選擇的分支，未讀完',
            'GetAdvancedStartNextStage 未逐指令讀完，只記下它有參與',
            '另外兩個讀取點（AchievementPanelScript.InitMilestonesPanel 與 '
            'TutorialEventModel.CheckAlreadyCompleted）只記下位置，未讀其用途',
        ],
    }
    target = ROOT/'reference/tt2/8.2.0/prestige-unlock-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Verified the prestige threshold: minimumPrestigeStage = {values["minimumPrestigeStage"]} '
          f'is the floor of GetPrestigeStage ({len(readers)} readers); the native requirement above it '
          f'is {percent} of the highest prestige stage, which the engine does not implement.')


if __name__ == '__main__':
    main()
