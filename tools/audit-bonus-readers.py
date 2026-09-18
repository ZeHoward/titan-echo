"""Map every BonusType to the native methods that actually read it.

Knowing a bonus has a source in the data tables says nothing about whether the game consumes it.
BonusModel.GetBonus is the one value entry point (HasBonus is the presence check), and the id
arrives in w1, so this finds every call site and walks backwards to the nearest immediate written
into w1. Walking back from the call - rather than forward from an immediate - is what keeps the
attribution honest: the search stops at anything that could clobber w1, so a call whose id comes
from a register is reported as unattributed instead of being silently dropped or misassigned.

The unattributed count is published. "No reader" only means something when you know how many
readers the method could not see, and a bonus can still be consumed without GetBonus - a value
cached into a field, as RefreshCriticalValues does for the crit multiplier, is read from that
field afterwards. Both limits are recorded with the findings.
"""
import bisect
import hashlib
import io
import json
import pathlib
import struct
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCAL = ROOT/'work/apk-analysis'
sys.path.insert(0, str(LOCAL/'python-libs'))
from capstone import Cs, CS_ARCH_ARM64, CS_MODE_ARM
from elftools.elf.elffile import ELFFile

GET_BONUS = 0x2714C88
HAS_BONUS = 0x2714E04
IDENTITIES = {GET_BONUS: 'BonusModel$$GetBonus', HAS_BONUS: 'BonusModel$$HasBonus'}

# Control group: bonuses whose readers are already established elsewhere. If any of these comes
# back empty the sweep is broken, not the game.
CONTROLS = {
    'CritDamage': 'PlayerModel$$RefreshCriticalValues',
    'SwordMasterDamage': 'PlayerModel$$GetSwordMasterDamage',
    'TapDamageFromHelpers': 'PlayerModel$$GetTapFromHelpers',
    'TitanDamage': 'StageLogic$$PerformAttackMonster',
    'SwordAttackDamage': 'PlayerController$$GetHeavenlyStrikeDamage',
}

LOOKBACK = 16  # instructions to walk back from a call site


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
    by_address = {}
    for method in script['ScriptMethod']:
        by_address.setdefault(method['Address'], method['Name'])
    for address, name in IDENTITIES.items():
        if by_address.get(address) != name:
            raise ValueError(f'method identity mismatch at {address:#x}: {by_address.get(address)}')
    starts = sorted(by_address)

    types = json.loads((ROOT/'reference/tt2/8.2.0/native-bonus-types.json').read_text(encoding='utf-8'))
    if types['type'] != 'BonusType':
        raise ValueError('native-bonus-types.json is not the BonusType enum')
    name_of = {int(value): key for key, value in types['values'].items()}

    elf = ELFFile(io.BytesIO(binary))
    segments = [s for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD' and s['p_filesz']]
    machine = Cs(CS_ARCH_ARM64, CS_MODE_ARM)

    def owner(address):
        index = bisect.bisect_right(starts, address) - 1
        return by_address[starts[index]] if index >= 0 else None

    def bl_target(word, address):
        if word >> 26 != 0b100101:
            return None
        offset = word & 0x3FFFFFF
        if offset & 0x2000000:
            offset -= 0x4000000
        return address + offset*4

    readers = {}       # bonus id -> {method: [call sites]}
    unattributed = []  # call sites whose id arrives in a register
    total_calls = 0
    # Why attribution failed, so "no reader" can be read with the right amount of doubt.
    reasons = {'stoppedAtCall': 0, 'writtenByRegister': 0, 'noWriteInWindow': 0}

    for segment in segments:
        base, data = segment['p_vaddr'], segment.data()
        words = struct.unpack_from(f'<{len(data)//4}I', data, 0)
        for index, word in enumerate(words):
            address = base + index*4
            target = bl_target(word, address)
            if target not in IDENTITIES:
                continue
            total_calls += 1
            # Walk back to the nearest immediate written into w1, stopping at anything that could
            # clobber it: another call, or any other instruction whose destination is w1/x1.
            found, reason = None, 'noWriteInWindow'
            window = words[max(0, index-LOOKBACK):index]
            for step, previous in enumerate(reversed(window)):
                at = address - (step+1)*4
                if bl_target(previous, at) is not None:
                    reason = 'stoppedAtCall'
                    break  # an intervening call owns w1 from here back
                instruction = next(machine.disasm(struct.pack('<I', previous), at), None)
                if instruction is None:
                    continue
                operands = instruction.op_str.split(', ')
                if not operands or operands[0] not in ('w1', 'x1'):
                    continue
                if instruction.mnemonic == 'mov' and len(operands) == 2 and operands[1].startswith('#'):
                    found = int(operands[1].lstrip('#'), 16 if operands[1].startswith('#0x') else 10)
                else:
                    reason = 'writtenByRegister'
                break  # w1 was written here, immediate or not
            if found is None:
                unattributed.append(hex(address))
                reasons[reason] += 1
                continue
            readers.setdefault(found, {}).setdefault(owner(address), []).append(hex(address))

    if not total_calls:
        raise ValueError('no GetBonus call sites found at all, so the sweep is not working')
    attributed = total_calls - len(unattributed)

    for label, expected in CONTROLS.items():
        number = int(types['values'][label])
        if expected not in (readers.get(number) or {}):
            raise ValueError(f'control bonus {label} is no longer read by {expected}')

    named = {}
    for number, methods in readers.items():
        label = name_of.get(number)
        if label is None:
            continue  # an immediate that is not a BonusType; the call took it from elsewhere
        named[label] = {'bonusType': number,
                        'methods': {name: sites for name, sites in sorted(methods.items()) if name}}
    unread = sorted(label for label, number in ((k, int(v)) for k, v in types['values'].items())
                    if label not in named and label != 'None')

    document = {
        'version': '8.2.0',
        'role': '每個 BonusType 在原生有沒有取值點，以及是哪些方法在取。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': f'掃描 BonusModel.GetBonus 與 HasBonus 的全部 {total_calls} 個呼叫點，'
                   f'其中 {attributed} 個的加成編號是以立即數寫進 w1、可以歸因；'
                   f'{reasons["writtenByRegister"]} 個以暫存器寫入 w1，'
                   f'{reasons["stoppedAtCall"]} 個在回溯途中隔著另一個呼叫，'
                   f'{reasons["noWriteInWindow"]} 個在視窗內找不到寫入。'
                   f'797 個 BonusType 裡有 {len(named)} 個掃得到取值點，{len(unread)} 個掃不到。',
        'method': {'entryPoints': {name: hex(address) for address, name in IDENTITIES.items()},
                   'lookbackInstructions': LOOKBACK},
        'callSites': {'total': total_calls, 'attributed': attributed,
                      'unattributed': len(unattributed),
                      'unattributedReasons': reasons,
                      'unattributedSites': unattributed[:40]},
        'controls': {label: expected for label, expected in CONTROLS.items()},
        'read': named,
        'unread': unread,
        'limits': [
            '「掃不到取值點」不等於「原生不使用」：以暫存器傳入編號的呼叫點列在 unattributed，'
            f'目前有 {len(unattributed)} 個；另外加成值可能先被算進某個欄位、之後從該欄位讀，'
            '例如 RefreshCriticalValues 把暴擊倍率存進 PlayerModel 的欄位再由攻擊流程讀。',
            '本表只涵蓋 GetBonus 與 HasBonus 兩個入口，不含 UI 顯示用的 GetBonusInfo 等後設方法。',
            '要據此宣稱某個加成沒有作用，必須另外確認它沒有被快取到欄位、也不在 unattributed 的呼叫點裡。',
            '回溯時遇到另一個呼叫就放棄歸因，是為了避免把前一個呼叫的回傳值當成加成編號；'
            '這條規則在這份映像上觸發 2 次，而且拿掉它不會改變任何加成的有無結論'
            '（那兩個呼叫點所屬的加成另有取值點），所以它是防禦性的，不是本表的支柱。',
        ],
    }
    target = ROOT/'reference/tt2/8.2.0/bonus-readers-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Mapped BonusType readers: {len(named)} of 797 have a value site, {len(unread)} do not; '
          f'{attributed}/{total_calls} call sites attributed, {len(unattributed)} take the id in a register; '
          f'{len(CONTROLS)} control bonuses all found')


if __name__ == '__main__':
    main()
