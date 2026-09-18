"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

A stage does not always spawn one titan. MonsterController.SpawnMonster rolls once per spawn and,
when the roll lands, puts a whole group on the screen instead; MonsterModel.GetMonsterGoldDrop then
settles that group's gold in a single payout. Neither the roll nor the payout is in any bundled
table, so this walks all three methods that make up the system and pins their shapes instruction by
instruction:

  * the spawn roll        - Random.value < GetBonus(MultiMonsters) x GetBonus(AllProbabilityBoost)
  * the group size        - (int)Random.Range(minMultiMonsterSpawns, GetBonus(MultiMonstersMaxCount) + 1)
  * the gold for a group  - x (1 + (size - 1) x GetBonus(MultiMonstersGold))

and, as a cross-check that those three agree with each other, BonusModel.GetAverageMultiMonsterSpawn,
the game's own average-size estimate.

The bases the three bonuses start from are not recovered here - BonusModel.SetDefaultBonuses supplies
them and audit-bonus-defaults.py already publishes that table. This one records which of its entries
the system depends on so the two stay tied together.
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

# MonsterController.SpawnMonster(int stageLevel, MonsterClass) - the public overload that rolls the
# group, not the private one it then calls with the resulting count.
SPAWN_MONSTER = 0x231E2D8
GOLD_DROP = 0x2326D1C         # MonsterModel.GetMonsterGoldDrop
AVERAGE_SPAWN = 0x2718620     # BonusModel.GetAverageMultiMonsterSpawn
GET_BONUS = 0x2714C88         # BonusModel.GetBonus

# The one ServerVarsModel static the system reads directly rather than through a bonus.
MIN_SPAWNS = 0xA14            # minMultiMonsterSpawns

# BonusType ids, checked against the published enum rather than trusted from here.
BONUS_IDS = {'MultiMonsters': 340, 'MultiMonstersMaxCount': 343,
             'MultiMonstersGold': 341, 'AllProbabilityBoost': 27}

# Singleton plumbing: every GetBonus is preceded by one of these, and none of them is arithmetic.
NOISE = {'get_instance'}

# The bases these bonuses are seeded with, published by audit-bonus-defaults.py.
BASE_OF = {'MultiMonsters': 'multiMonsterBaseChance',
           'MultiMonstersMaxCount': 'maxMultiMonsterSpawns',
           'MultiMonstersGold': 'monsterMultiSpawnGoldBonus'}


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

    def body(address, cap=0x2000):
        following = next((a for a in starts if a > address), address+cap)
        return read(address, min(following-address, cap))

    def fact(address):
        return {'name': symbols[address], 'rva': hex(address), 'bytesSha256': sha(body(address))}

    for address, name in {SPAWN_MONSTER: 'MonsterController$$SpawnMonster',
                          GOLD_DROP: 'MonsterModel$$GetMonsterGoldDrop',
                          AVERAGE_SPAWN: 'BonusModel$$GetAverageMultiMonsterSpawn',
                          GET_BONUS: 'BonusModel$$GetBonus'}.items():
        if symbols.get(address) != name:
            raise ValueError(f'method identity mismatch at {address:#x}: {symbols.get(address)!r}')

    # The ids come from the published enum; a renumbered BonusType fails here, not silently.
    enum = json.loads((ROOT/'reference/tt2/8.2.0/native-bonus-types.json').read_text(encoding='utf-8'))
    for name, wanted in BONUS_IDS.items():
        if int(enum['values'][name]) != wanted:
            raise ValueError(f'{name} is {enum["values"][name]}, not {wanted}')
    by_id = {value: name for name, value in BONUS_IDS.items()}

    # minMultiMonsterSpawns must still be the float at that offset, or the ldr below means nothing.
    block = re.search(r'^public class ServerVarsModel(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)
    if not re.search(r'public static float minMultiMonsterSpawns; // 0x'+f'{MIN_SPAWNS:X}'+r'\b', block):
        raise ValueError(f'minMultiMonsterSpawns is no longer a float at {MIN_SPAWNS:#x}')

    def trace(address):
        """The ordered events that matter: which bonus is fetched, which static is read, which
        float op is applied, and which runtime helper is called."""
        events, pending = [], None
        for ins in machine.disasm(body(address), address):
            if ins.mnemonic == 'mov':
                m = re.fullmatch(r'w1, #(0x[0-9a-f]+|\d+)', ins.op_str)
                pending = int(m.group(1), 0) if m else pending
            elif ins.mnemonic == 'ldr':
                m = re.fullmatch(r's\d+, \[x\d+, #(0x[0-9a-f]+)\]', ins.op_str)
                if m and int(m.group(1), 16) == MIN_SPAWNS:
                    events.append(('static', 'minMultiMonsterSpawns', hex(ins.address)))
            elif ins.mnemonic in ('fmul', 'fadd', 'fcmp', 'fcvtzs', 'scvtf'):
                events.append((ins.mnemonic, ins.op_str, hex(ins.address)))
            elif ins.mnemonic == 'fmov' and re.fullmatch(r's\d+, #[\d.]+', ins.op_str):
                events.append(('const', ins.op_str.split('#')[1], hex(ins.address)))
            elif ins.mnemonic == 'bl' and ins.op_str.startswith('#'):
                target = int(ins.op_str.lstrip('#'), 16)
                name = symbols.get(target, '')
                if target == GET_BONUS:
                    events.append(('GetBonus', by_id.get(pending, f'BonusType#{pending}'), hex(ins.address)))
                elif name and name.split('$$')[-1] not in NOISE:
                    events.append(('call', name.split('$$')[-1], hex(ins.address)))
        return events

    def window(events, first, last):
        """The slice of a trace between two addresses, so a long method is quoted, not dumped."""
        return [e for e in events if first <= int(e[2], 16) <= last]

    spawn = trace(SPAWN_MONSTER)
    gold = trace(GOLD_DROP)
    average = trace(AVERAGE_SPAWN)

    # --- the spawn roll and the group size, both inside SpawnMonster ---
    roll = window(spawn, 0x231E44C, 0x231E4FC)
    kinds = [(e[0], e[1]) for e in roll]
    expected_roll = [('call', 'get_value'), ('GetBonus', 'MultiMonsters'),
                     ('GetBonus', 'AllProbabilityBoost'), ('call', 'op_Multiply'),
                     ('call', 'op_Explicit'), ('fcmp', 's8, s0')]
    if kinds != expected_roll:
        raise ValueError(f'spawn roll changed shape: {kinds}')

    size = window(spawn, 0x231E500, 0x231E590)
    kinds = [(e[0], e[1]) for e in size]
    expected_size = [('static', 'minMultiMonsterSpawns'), ('GetBonus', 'MultiMonstersMaxCount'),
                     ('call', 'op_Explicit'), ('const', '1.00000000'), ('fadd', 's1, s0, s1'),
                     ('call', 'Range'), ('fcvtzs', 'w10, s0')]
    if kinds != expected_size:
        raise ValueError(f'group size changed shape: {kinds}')

    # --- the gold for a group, inside GetMonsterGoldDrop ---
    payout = window(gold, 0x23270B4, 0x2327154)
    kinds = [(e[0], e[1]) for e in payout]
    expected_payout = [('call', 'op_Implicit'), ('call', 'op_Implicit'),
                       ('GetBonus', 'MultiMonstersGold'), ('call', 'op_Multiply'),
                       ('call', 'op_Addition')]
    if kinds != expected_payout:
        raise ValueError(f'group payout changed shape: {kinds}')

    # --- the game's own average-size estimate, as a cross-check on the two above ---
    kinds = [(e[0], e[1]) for e in average]
    expected_average = [('static', 'minMultiMonsterSpawns'), ('GetBonus', 'MultiMonstersMaxCount'),
                        ('call', 'op_Explicit'), ('fadd', 's0, s8, s0'), ('const', '0.50000000'),
                        ('fmul', 's8, s0, s1'), ('GetBonus', 'MultiMonsters'),
                        ('GetBonus', 'AllProbabilityBoost'), ('call', 'op_Multiply'),
                        ('call', 'op_Explicit'), ('fmul', 's0, s8, s0'), ('const', '1.00000000'),
                        ('fadd', 's0, s0, s1')]
    if kinds != expected_average:
        raise ValueError(f'average estimate changed shape: {kinds}')

    # The bases are audit-bonus-defaults.py's to publish; this only checks they are still there.
    defaults = json.loads((ROOT/'reference/tt2/8.2.0/bonus-defaults-evidence.json')
                          .read_text(encoding='utf-8'))['defaults']
    bases = {}
    for bonus, field in BASE_OF.items():
        entry = defaults.get(bonus)
        if not entry or entry['field'] != field:
            raise ValueError(f'{bonus} no longer defaults from {field}; rerun audit-bonus-defaults.py')
        bases[bonus] = {'field': field, 'value': entry['value']}

    servervars = json.loads((ROOT/'reference/tt2/8.2.0/servervar-defaults.json')
                            .read_text(encoding='utf-8'))['recovered']
    if 'minMultiMonsterSpawns' not in servervars:
        raise ValueError('minMultiMonsterSpawns has no recovered default')
    minimum = servervars['minMultiMonsterSpawns']['value']

    chance = bases['MultiMonsters']['value']
    maximum = bases['MultiMonstersMaxCount']['value']
    document = {
        'version': '8.2.0',
        'role': '多重泰坦生成：生成骰、一波的隻數、一波的金幣結算，以及原生自己的平均隻數估計。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': 'MonsterController.SpawnMonster 每次生成擲一次骰：Random.value 小於 '
                   'MultiMonsters × AllProbabilityBoost 時，這一波不是一隻而是一群，'
                   '隻數為 (int)Random.Range(minMultiMonsterSpawns, MultiMonstersMaxCount + 1)。'
                   'MonsterModel.GetMonsterGoldDrop 收到那個隻數，把一波的金幣一次結算成 '
                   '單隻金幣 × (1 + (隻數 − 1) × MultiMonstersGold)。'
                   f'三個加成的基底分別是 {chance}、{maximum}、{bases["MultiMonstersGold"]["value"]}，'
                   f'下限 minMultiMonsterSpawns 是 {minimum}，'
                   f'所以未投資的玩家是 {chance:.0%} 機率生出 {minimum:.0f}–{maximum:.0f} 隻。',
        'consequence': '金幣是一次結算而不是逐隻給，所以「一波幾隻」同時決定血量、擊殺數與金幣倍率；'
                       'MultiMonstersGold 只放大額外的那幾隻，一隻的一波永遠是 1 倍。'
                       '三個基底與 minMultiMonsterSpawns 都是 [ServerVar] 的編譯期預設值，線上可覆蓋，狀態為 default。',
        'methods': {name: fact(address) for name, address in
                    {'spawn': SPAWN_MONSTER, 'gold': GOLD_DROP, 'average': AVERAGE_SPAWN}.items()},
        'formulas': {
            'spawnRoll': 'Random.value < MultiMonsters × AllProbabilityBoost',
            'groupSize': '(int)Random.Range(minMultiMonsterSpawns, MultiMonstersMaxCount + 1)',
            'groupGold': '單隻金幣 × (1 + (隻數 − 1) × MultiMonstersGold)',
            'averageSize': '1 + ((minMultiMonsterSpawns + MultiMonstersMaxCount) ÷ 2) '
                           '× MultiMonsters × AllProbabilityBoost',
        },
        'traces': {'spawnRoll': roll, 'groupSize': size, 'groupGold': payout, 'averageSize': average},
        'bases': bases,
        'minMultiMonsterSpawns': {'offset': hex(MIN_SPAWNS), 'value': minimum},
        'bonusIds': BONUS_IDS,
        'limits': [
            '原生的平均估計把 Random.Range 的半開區間當成閉區間，少算了 0.5 隻，而且沒有乘上'
            '「沒中骰時是一隻」那一項；它只用在 UI 預覽，不是實際生成，所以兩者本來就不會相等。',
            '原生在取到隻數後還會夾到場上怪物物件池的大小（SpawnMonster 尾端的 csel）。'
            '那是 Unity 的物件池上限，不是遊戲規則，本專案沒有對應概念。',
            'GetMonsterGoldDrop 的其他項（GoldAll、GoldMonster、契約金幣等）不在本文件範圍內。',
        ],
    }
    out = ROOT/'reference/tt2/8.2.0/multi-monster-evidence.json'
    out.write_bytes((json.dumps(document, ensure_ascii=False, indent=2)+'\n').encode('utf-8'))
    print(f'wrote {out.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
