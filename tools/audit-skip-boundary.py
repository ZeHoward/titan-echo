"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

Titan skip and stage skip are not one global stat. StageLogic.GetTitanSkip and GetStageSkip both
switch on DamageType and add a source-specific bonus to a shared base, so Heavenly Strike, the pet
and the Shadow Clone each carry their own skip. StatsPanelScript.InitTitanAndStageSkipStats spells
the same pairing out as (BonusType, DamageType) literals, which is where the table below comes from;
this audit reads both and fails if they stop agreeing. It also settles what is left of "splash":
DoSplashOverkill only drives the coin animation and the floating text, and the splash-count bonuses
that would matter here either are not in the data table or have no source, so for the sources this
project simulates the splash *is* the titan skip. It also pins where the skips fire
(OnMonsterDeath, not on every hit) and that skipped titans and stages still pay gold.
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

GET_TITAN_SKIP = 0x2544194
GET_STAGE_SKIP = 0x25448E4
DO_TITAN_SKIP = 0x2544080
DO_STAGE_SKIP = 0x2544724
DO_OVERKILL = 0x2544650
INIT_STATS = 0x255BC64
CREATE_TITAN_ITEM = 0x255D834
CREATE_STAGE_ITEM = 0x255DB30

IDENTITIES = {
    GET_TITAN_SKIP: 'StageLogic$$GetTitanSkip',
    GET_STAGE_SKIP: 'StageLogic$$GetStageSkip',
    DO_TITAN_SKIP: 'StageLogic$$DoSplashTitanSkip',
    DO_STAGE_SKIP: 'StageLogic$$DoSplashStageSkip',
    DO_OVERKILL: 'StageLogic$$DoSplashOverkill',
    INIT_STATS: 'StatsPanelScript$$InitTitanAndStageSkipStats',
    CREATE_TITAN_ITEM: 'StatsPanelScript$$CreateTitanSkipItem',
    CREATE_STAGE_ITEM: 'StatsPanelScript$$CreateStageSkipItem',
}

BASE_TITAN_SKIP = 472      # BonusType.TitanSkip
TITAN_SKIP_MULT = 473      # BonusType.TitanSkipMult
BASE_STAGE_SKIP = 443      # BonusType.StageSkip

# The damage sources this project actually simulates, so the evidence says what is implementable
# rather than only what exists. The rest belong to builds that are not written yet (B03-B09).
IMPLEMENTED = {'ActiveSkillHeavenlyStrike', 'Pet', 'ActiveSkillShadowClone'}

# 帶著編譯期預設值、但整個映像沒有任何 32 位元 LDR 讀它們的欄位。名字看起來像濺射的關鍵參數，
# 實際上在 8.2 是死的——照著它們實作等於自己發明規則。
DEAD_SPLASH_VARS = {'maxDefaultSplashKills': 0xD64, 'maxSpecialSplashKills': 0xD68}
# 對照組：這個位移確定有讀取點，用來證明掃描本身有效而不是永遠回空。
LIVE_CONTROL = ('equipmentStageMin', 0x4AC, 'EquipmentModel$$IsEquipmentDropBoss')


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
        end = following[start]
        segment = next(s for s in elf.iter_segments()
                       if s['p_type'] == 'PT_LOAD' and s['p_vaddr'] <= start
                       and end <= s['p_vaddr'] + s['p_filesz'])
        offset = start - segment['p_vaddr'] + segment['p_offset']
        return binary[offset:offset + (end - start)]

    machine = Cs(CS_ARCH_ARM64, CS_MODE_ARM)
    decode = lambda start: list(machine.disasm(body(start), start))

    def calls(start):
        out = []
        for instruction in decode(start):
            if instruction.mnemonic in ('bl', 'b') and instruction.op_str.startswith('#'):
                name = by_address.get(int(instruction.op_str.lstrip('#'), 16))
                if name:
                    out.append(name)
        return out

    # The stats panel lists one entry per source, so its literals are the pairing table.
    def pairs(target):
        found, pending = [], None
        for instruction in decode(INIT_STATS):
            match = re.fullmatch(r'w1, #(0x[0-9a-f]+|\d+)', instruction.op_str) if instruction.mnemonic == 'mov' else None
            if match:
                pending = int(match.group(1), 0)
                continue
            match = re.fullmatch(r'w2, #(0x[0-9a-f]+|\d+)', instruction.op_str) if instruction.mnemonic == 'mov' else None
            if match and pending is not None:
                damage_type = int(match.group(1), 0)
                continue
            if instruction.mnemonic == 'bl' and instruction.op_str.startswith('#'):
                if int(instruction.op_str.lstrip('#'), 16) == target and pending is not None:
                    found.append((pending, damage_type))
                pending = None
        return found

    titan_pairs = pairs(CREATE_TITAN_ITEM)
    stage_pairs = pairs(CREATE_STAGE_ITEM)
    if len(titan_pairs) != 6 or len(stage_pairs) != 7:
        raise ValueError(f'source count changed: {len(titan_pairs)} titan, {len(stage_pairs)} stage')

    # Names, so the table is readable and a renumbered enum fails instead of lying.
    dump = (LOCAL/'dump/dump.cs').read_text(encoding='utf-8', errors='replace')
    start = dump.index('public enum BonusType')
    block = dump[start:dump.index('\n}', start)]
    bonus_names = {int(n): name for name, n in
                   re.findall(r'public const BonusType ([A-Za-z0-9_]+) = (\d+);', block)}
    damage_types = json.loads((ROOT/'reference/tt2/8.2.0/damage-text-evidence.json')
                              .read_text(encoding='utf-8'))['damageTypes']
    damage_names = {value: name for name, value in damage_types.items()}
    for number in (BASE_TITAN_SKIP, TITAN_SKIP_MULT, BASE_STAGE_SKIP):
        if number not in bonus_names:
            raise ValueError(f'BonusType {number} is gone')
    if bonus_names[BASE_TITAN_SKIP] != 'TitanSkip' or bonus_names[TITAN_SKIP_MULT] != 'TitanSkipMult':
        raise ValueError('the base titan-skip bonuses were renumbered')

    def describe(found):
        out = []
        for bonus, damage_type in found:
            if bonus not in bonus_names or damage_type not in damage_names:
                raise ValueError(f'unknown pair {bonus}/{damage_type}')
            source = damage_names[damage_type]
            out.append({'bonus': bonus_names[bonus], 'bonusId': bonus,
                        'damageType': source, 'damageTypeId': damage_type,
                        'implementedHere': source in IMPLEMENTED})
        return out

    titan = describe(titan_pairs)
    stage = describe(stage_pairs)
    if {row['damageType'] for row in titan if row['implementedHere']} != IMPLEMENTED:
        raise ValueError('the three implemented sources no longer all carry a titan skip')

    # GetTitanSkip must still read the shared base and the single global multiplier.
    titan_body = [f'{i.mnemonic} {i.op_str}' for i in decode(GET_TITAN_SKIP)]
    for number in (BASE_TITAN_SKIP, TITAN_SKIP_MULT):
        if not any(re.fullmatch(rf'mov w1, #{number:#x}', line) for line in titan_body):
            raise ValueError(f'GetTitanSkip no longer reads BonusType {number}')
    for name in ('GHDouble$$op_Addition', 'GHDouble$$op_Multiply', 'GHDouble$$op_Explicit'):
        if name not in calls(GET_TITAN_SKIP):
            raise ValueError(f'GetTitanSkip no longer uses {name}')
    if not any(re.fullmatch(rf'mov w1, #{BASE_STAGE_SKIP:#x}', line)
               for line in (f'{i.mnemonic} {i.op_str}' for i in decode(GET_STAGE_SKIP))):
        raise ValueError('GetStageSkip no longer reads the shared base')

    # Where they fire, and that a skipped kill is still paid for.
    titan_calls, stage_calls = calls(DO_TITAN_SKIP), calls(DO_STAGE_SKIP)
    for name in ('StageLogic$$GetTitanSkip', 'MonsterModel$$GetNonBossSplashGoldDrop',
                 'StageLogic$$set_enemyKillCount', 'System.Math$$Min'):
        if name not in titan_calls:
            raise ValueError(f'DoSplashTitanSkip no longer uses {name}')
    for name in ('StageLogic$$GetStageSkip', 'MonsterModel$$GetBossSplashGoldDrop',
                 'StageLogicController$$GetMonsterCountPerStage'):
        if name not in stage_calls:
            raise ValueError(f'DoSplashStageSkip no longer uses {name}')

    # 兩個 Do* 都在結算完之後才叫 DoSplashOverkill，而它只播動畫與浮動文字：
    # 沒有 GetBonus、沒有金幣結算、沒有擊殺計數，所以濺射沒有額外的機制藏在那裡。
    overkill = set(calls(DO_OVERKILL))
    for name in ('CoinsQueue$$DropInGame', 'FadingTextQueue$$ShowMultiMonsterText'):
        if name not in overkill:
            raise ValueError(f'DoSplashOverkill no longer calls {name}')
    for name in overkill:
        if 'GetBonus' in name or 'GoldDrop' in name or 'enemyKillCount' in name:
            raise ValueError(f'DoSplashOverkill grew real bookkeeping: {name}')

    # Both are reached from OnMonsterDeath only, which is what makes "on a kill" a fact.
    # The same walk answers "does anything read this server variable", so it happens once.
    def owner(site, starts):
        low, high, best = 0, len(starts)-1, None
        while low <= high:
            middle = (low+high)//2
            if starts[middle] <= site:
                best, low = starts[middle], middle+1
            else:
                high = middle-1
        return by_address.get(best, "?")

    def walk(bl_targets, ldr_offsets):
        starts = addresses
        bl_hits = {target: set() for target in bl_targets}
        # ldr Wt, [Xn, #imm12*4] is 1011 1001 01 imm12 Rn Rt, fixed apart from the registers.
        wanted = {0xB9400000 | ((offset // 4) << 10): offset for offset in ldr_offsets}
        ldr_hits = {offset: set() for offset in ldr_offsets}
        for segment in elf.iter_segments():
            if segment['p_type'] != 'PT_LOAD':
                continue
            base = segment['p_vaddr']
            data = binary[segment['p_offset']:segment['p_offset']+segment['p_filesz']]
            for offset in range(0, len(data)-3, 4):
                word = struct.unpack_from('<I', data, offset)[0]
                site = base + offset
                if word >> 26 == 0b100101:
                    immediate = word & 0x03FFFFFF
                    if immediate & 0x02000000:
                        immediate -= 0x04000000
                    target = site + immediate*4
                    if target in bl_hits:
                        bl_hits[target].add(owner(site, starts))
                    continue
                masked = word & 0xFFFFFC00
                if masked in wanted:
                    ldr_hits[wanted[masked]].add(owner(site, starts))
        return bl_hits, ldr_hits

    bl_hits, ldr_hits = walk(
        [DO_TITAN_SKIP, DO_STAGE_SKIP],
        list(DEAD_SPLASH_VARS.values()) + [LIVE_CONTROL[1]])

    def callers(target):
        found = bl_hits[target]
        return found

    for target, label in ((DO_TITAN_SKIP, 'DoSplashTitanSkip'), (DO_STAGE_SKIP, 'DoSplashStageSkip')):
        sites = callers(target)
        if not sites or not all('OnMonsterDeath' in name for name in sites):
            raise ValueError(f'{label} is no longer reached only from OnMonsterDeath: {sorted(sites)}')

    # 對照組先證明掃描會找到東西，再宣稱那兩個欄位沒有人讀。
    control_name, control_offset, control_reader = LIVE_CONTROL
    if control_reader not in ldr_hits[control_offset]:
        raise ValueError(f'the LDR scan is broken: it cannot even find {control_reader}')
    dead = {}
    for name, offset in DEAD_SPLASH_VARS.items():
        if ldr_hits[offset]:
            raise ValueError(f'{name} now has readers: {sorted(ldr_hits[offset])}')
        dead[name] = {'offset': hex(offset), 'readers': 0}

    document = {
        'version': '8.2.0',
        'role': '跳泰坦與跳關：每個傷害來源各自一套，在擊殺時觸發，跳過的仍然給金幣。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': '跳過不是一個全域數值。`GetTitanSkip(DamageType)` 與 `GetStageSkip(DamageType)` 都以傷害來源分支，'
                   '把該來源專屬的加成加到共用的基礎值上，再乘一個倍率，最後取整數。'
                   '兩者都只從 `OnMonsterDeath` 進入，所以是**擊殺時**觸發，不是每次命中。',
        'rules': {
            'titanSkip': {
                'method': IDENTITIES[GET_TITAN_SKIP], 'rva': hex(GET_TITAN_SKIP),
                'expression': '(TitanSkip + 該來源的 TitanSkip) × TitanSkipMult，取整數',
                'apply': {'method': IDENTITIES[DO_TITAN_SKIP], 'rva': hex(DO_TITAN_SKIP),
                          'note': '把結果加進 enemyKillCount，並以 Math.Min 夾在本關剩餘隻數內；'
                                  '被跳過的泰坦照樣走 GetNonBossSplashGoldDrop 給金幣。'},
                'sources': titan,
            },
            'stageSkip': {
                'method': IDENTITIES[GET_STAGE_SKIP], 'rva': hex(GET_STAGE_SKIP),
                'expression': '(StageSkip + 該來源的 StageSkip) × 該來源專屬的 Mult，取整數',
                'apply': {'method': IDENTITIES[DO_STAGE_SKIP], 'rva': hex(DO_STAGE_SKIP),
                          'note': '跳過的每一關走 GetBossSplashGoldDrop 給頭目金幣，'
                                  '並以 GetMonsterCountPerStage 結算跳過的關卡裡的小怪。'},
                'sources': stage,
            },
        },
        'baseBonuses': {'titanSkip': bonus_names[BASE_TITAN_SKIP],
                        'titanSkipMult': bonus_names[TITAN_SKIP_MULT],
                        'stageSkip': bonus_names[BASE_STAGE_SKIP]},
        'splash': {
            'finding': '濺射在 8.2 沒有獨立於跳泰坦之外的機制。DoSplashOverkill 只呼叫掉金幣動畫'
                       '（CoinsQueue.DropInGame）與「擊殺 N 隻」浮動文字（FadingTextQueue.ShowMultiMonsterText），'
                       '結算在它之前就做完了；濺射的隻數就是 GetTitanSkip 的結果。',
            'overkillMethod': {'method': IDENTITIES[DO_OVERKILL], 'rva': hex(DO_OVERKILL),
                               'role': '表現層：掉金幣動畫與浮動文字，沒有任何結算。'},
            'enumOnlyBonuses': ['SplashGold', 'PetAttackQTESplashCount'],
            'noSourceBonuses': ['ShadowCloneBossSplash'],
            'deadServerVars': dead,
            'note': 'SplashGold 與 PetAttackQTESplashCount 只存在於 BonusType 列舉，不在加成資料表裡；'
                    'ShadowCloneBossSplash 在資料表裡，但沒有任何天賦、神器、套裝或寵物給它，恆為 0。'
                    'SorcererStageSkipMult 的說明提到 BurstSkillSplashCountMult 與 ShadowCloneSplashCountMult，'
                    '這兩個名字在 BonusType 列舉裡根本不存在——說明文字是過時的。'
                    'maxDefaultSplashKills 與 maxSpecialSplashKills 帶著預設值 3 與 928，'
                    '但整個映像沒有任何 32 位元 LDR 讀它們，在 8.2 是死的。',
        },
        'implementableHere': sorted(IMPLEMENTED),
        'consequence': '本專案有天堂聖擊、寵物攻擊與影分身三個來源，這三條可以照做；'
                       '公會飛船、匕首、金槍與寵物爆發的跳過要等對應流派實作，'
                       '在那之前不應該把它們的加成折算到別的來源上。',
        'limits': ['方法存在、位址與其呼叫是事實；BonusType 的實際數值仍由加成系統決定',
                   '本表不涵蓋 DoSplashOverkill 的溢出傷害分配'],
    }
    target = ROOT/'reference/tt2/8.2.0/skip-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    usable = sum(1 for row in titan + stage if row['implementedHere'])
    print(f'Verified the skip boundary: {len(titan)} titan sources, {len(stage)} stage sources, '
          f'{usable} of them implementable here; {len(dead)} splash server variables have no reader')


if __name__ == '__main__':
    main()
