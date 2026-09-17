"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

Where does a dropped piece of equipment come from? The package carries the full equipment table —
983 definitions with slot, rarity, set and the primary-stat coefficients — which reads as though the
drop could be rebuilt from it. Only half of it can. The client decides *when* a drop is available
(EquipmentModel.IsEquipmentDropBoss, off two named server variables); *what* drops is a server
round trip (EquipmentController.CollectRequest -> ServerAPI.EquipmentReward -> the reward list is
parsed back into EquipmentInfo). This records which side of that line each method sits on, and pins
the drop-stage arithmetic instruction by instruction so a later version cannot change it silently.
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

# Identity is pinned by address -> name, so a rename or a shifted method fails loudly.
DROP_BOSS = 0x2190C60       # EquipmentModel$$IsEquipmentDropBoss
COLLECT_REQUEST = 0x217C728  # EquipmentController$$CollectRequest
REWARD_LIST = 0x217D8D8     # EquipmentController$$ProcessEquipmentRewardList
PARSE_INFO = 0x217E51C      # EquipmentModel$$ParseEquipmentInfo(Dictionary, bool)
EFFECTIVE_LEVEL = 0x21884E8  # EquipmentModel$$GetEffectiveLevel

IDENTITIES = {
    DROP_BOSS: 'EquipmentModel$$IsEquipmentDropBoss',
    COLLECT_REQUEST: 'EquipmentController$$CollectRequest',
    REWARD_LIST: 'EquipmentController$$ProcessEquipmentRewardList',
    PARSE_INFO: 'EquipmentModel$$ParseEquipmentInfo',
    EFFECTIVE_LEVEL: 'EquipmentModel$$GetEffectiveLevel',
}

# The two server variables the drop-stage test reads, by ServerVarsModel struct offset.
STAGE_MIN_OFFSET = 0x4AC
STAGE_DELTA_OFFSET = 0x4B0
# GetEffectiveLevel's two, kept here because the same audit covers the whole drop-to-backpack path.
REDUCTION_MIN_OFFSET = 0x514
REDUCTION_AMOUNT_OFFSET = 0x518

# Calls that must be present, because the finding rests on them.
REQUIRED_CALLS = {
    COLLECT_REQUEST: ['ServerAPI$$EquipmentReward'],
    REWARD_LIST: ['EquipmentModel$$ParseEquipmentInfo', 'EquipmentModel$$AddToBackpack',
                  'ServerResponse$$GetValueOrDefault<int>'],
    PARSE_INFO: ['EquipmentInfo$$AddSecondaryBonus', 'EquipmentInfo$$ClearSecondaryList',
                 'EquipmentInfo$$RefreshPrimaryBonus', 'EquipmentMetaData$$GetEquipmentLevelBonus'],
    DROP_BOSS: ['MonsterModel$$IsBoss', 'PlayerModel$$GetSeasonalMaxStageReached',
                'System.Collections.Generic.List<int>$$Contains'],
}


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

    addresses = sorted(by_address)
    following = {a: b for a, b in zip(addresses, addresses[1:])}
    elf = ELFFile(io.BytesIO(binary))

    def body(start):
        end = following.get(start)
        if end is None or end <= start or end - start > 1 << 16:
            raise ValueError(f'cannot bound method at {start:#x}')
        segment = next(s for s in elf.iter_segments()
                       if s['p_type'] == 'PT_LOAD' and s['p_vaddr'] <= start
                       and end <= s['p_vaddr'] + s['p_filesz'])
        offset = start - segment['p_vaddr'] + segment['p_offset']
        return binary[offset:offset + (end - start)]

    machine = Cs(CS_ARCH_ARM64, CS_MODE_ARM)

    def decode(start):
        return list(machine.disasm(body(start), start))

    def calls(start):
        out = []
        for instruction in decode(start):
            if instruction.mnemonic in ('bl', 'b') and instruction.op_str.startswith('#'):
                name = by_address.get(int(instruction.op_str.lstrip('#'), 16))
                if name:
                    out.append(name)
        return out

    for address, required in REQUIRED_CALLS.items():
        found = set(calls(address))
        for name in required:
            if name not in found:
                raise ValueError(f'{IDENTITIES[address]} no longer calls {name}')

    # The drop-stage test, instruction by instruction. The native counter is zero-based: the
    # fallback path asks extraEquipmentDrops.Contains(stage + 1), so "stage" here is one below the
    # number the player sees. Read that way the test below is (shown - stageMin) % stageDelta == 0.
    drop = decode(DROP_BOSS)
    text = [f'{i.mnemonic} {i.op_str}' for i in drop]
    wanted = [
        rf'ldr w\d+, \[x\d+, #{STAGE_MIN_OFFSET:#x}\]',   # equipmentStageMin
        r'sub w\d+, w\d+, w\d+',                          # stage - stageMin
        r'adds w\d+, w\d+, #1',                           # + 1, and the sign test that follows
        r'b\.mi #0x[0-9a-f]+',                            # negative -> no drop
        rf'ldr w\d+, \[x\d+, #{STAGE_DELTA_OFFSET:#x}\]',  # equipmentStageDelta
        r'sdiv w\d+, w\d+, w\d+',                         # the remainder, as sdiv + msub
        r'msub w\d+, w\d+, w\d+, w\d+',
        r'cset w\d+, eq',                                 # remainder == 0 -> drop
    ]
    cursor = 0
    for pattern in wanted:
        match = next((n for n in range(cursor, len(text)) if re.fullmatch(pattern, text[n])), None)
        if match is None:
            raise ValueError(f'drop-stage arithmetic changed: no {pattern} after instruction {cursor}')
        cursor = match + 1

    # GetEffectiveLevel's two offsets, cross-checked against the recovered defaults.
    effective = [f'{i.mnemonic} {i.op_str}' for i in decode(EFFECTIVE_LEVEL)]
    for offset in (REDUCTION_MIN_OFFSET, REDUCTION_AMOUNT_OFFSET):
        if not any(re.fullmatch(rf'ldr [ws]\d+, \[x\d+, #{offset:#x}\]', line) for line in effective):
            raise ValueError(f'GetEffectiveLevel no longer reads {offset:#x}')
    if not any(line.startswith('frintm') for line in effective):
        raise ValueError('GetEffectiveLevel no longer floors its result')

    defaults = json.loads((ROOT/'reference/tt2/8.2.0/servervar-defaults.json').read_text(encoding='utf-8'))
    recovered = defaults['recovered']
    variables = {}
    for name, offset in (('equipmentStageMin', STAGE_MIN_OFFSET),
                         ('equipmentStageDelta', STAGE_DELTA_OFFSET),
                         ('equipmentLevelReductionMin', REDUCTION_MIN_OFFSET),
                         ('equipmentLevelReductionAmount', REDUCTION_AMOUNT_OFFSET)):
        entry = recovered.get(name)
        if entry is None:
            raise ValueError(f'{name} is not in the recovered defaults')
        if int(entry['offset'], 16) != offset:
            raise ValueError(f'{name} offset moved: {entry["offset"]} vs {offset:#x}')
        variables[name] = {'offset': entry['offset'], 'type': entry['type'],
                           'defaultValue': entry['value'], 'status': 'default'}

    document = {
        'version': '8.2.0',
        'role': '裝備掉落的界線：時機由客戶端算，掉落內容由伺服器決定。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': '掉落「什麼時候有」是客戶端的：IsEquipmentDropBoss 在頭目關卡上比對本季最高關卡，'
                   '以 (關卡 − equipmentStageMin + 1) % equipmentStageDelta == 0 判斷，命中才掉。'
                   '掉落「是什麼」不是：CollectRequest 把當前關卡送給 ServerAPI.EquipmentReward，'
                   'ProcessEquipmentRewardList 逐項把回應交給 ParseEquipmentInfo(Dictionary, bool)，'
                   '裝備 ID、等級、鎖定狀態與副屬性清單全部從那個字典讀出來。',
        'consequence': '掉落的等級分布、品質分布與副屬性種類在安裝包內沒有值，不能自行編造；'
                       '可從包內核實的是掉落關卡、主屬性算式（EquipmentMetaData 的資料表）'
                       '與高等級的遞減（GetEffectiveLevel）。',
        'clientSide': {
            'dropStage': {
                'method': IDENTITIES[DROP_BOSS], 'rva': hex(DROP_BOSS),
                'rule': '(關卡 − equipmentStageMin + 1) % equipmentStageDelta == 0，且差值不為負；'
                        '原生計數是 0 起算（回退路徑問的是 extraEquipmentDrops.Contains(關卡 + 1)），'
                        '換成玩家看到的關卡就是 (關卡 − 16) % 20 == 0 且關卡 ≥ 16，即 16、36、56…',
                'guard': '只有在「當前關卡等於本季最高關卡」時才走這條算式；'
                         '重打已經過的關卡改查 extraEquipmentDrops，那份清單由伺服器給'
                         '（EquipmentModel.SetNewEquipmentDropStages），包內沒有內容。',
            },
            'effectiveLevel': {
                'method': IDENTITIES[EFFECTIVE_LEVEL], 'rva': hex(EFFECTIVE_LEVEL),
                'rule': 'level ≤ equipmentLevelReductionMin 時取 floor(level)；'
                        '超過才是 floor((level − min)^amount + min)。',
                'inertBelow': recovered['equipmentLevelReductionMin']['value'],
                'note': '門檻 357803 遠高於本專案可達的裝備等級，在可玩範圍內這條恆等於 floor(level)。',
            },
        },
        'serverOutcome': {
            name: {'rva': hex(address)}
            for address, name in ((COLLECT_REQUEST, IDENTITIES[COLLECT_REQUEST]),
                                  (REWARD_LIST, IDENTITIES[REWARD_LIST]),
                                  (PARSE_INFO, IDENTITIES[PARSE_INFO]))
        },
        'serverSupplied': ['EquipmentModel$$SetNewEquipmentDropStages 的 extraEquipmentDrops 清單'],
        'parsedFromResponse': ['裝備 ID', '等級', '鎖定狀態', '副屬性清單'],
        'serverVariables': variables,
        'limits': ['方法存在與其位址是事實，方法內部的伺服器請求與回應內容不在包內',
                   '這四個變數引用的是編譯期預設值，線上可覆蓋，不宣稱與線上一致'],
    }
    target = ROOT/'reference/tt2/8.2.0/equipment-drop-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Verified the equipment drop boundary: {len(document["clientSide"])} client-side rules, '
          f'{len(document["serverOutcome"])} server-outcome methods, {len(variables)} server variables')


if __name__ == '__main__':
    main()
