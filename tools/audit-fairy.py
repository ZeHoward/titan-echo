"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

FairySpawnChance is not "how often a fairy turns up" - the game's own label calls it the multi-fairy
chance, and the code agrees. FairyController.MultiFairySpawn spawns one fairy unconditionally and
then rolls for extras: each extra needs its own roll, the chance is halved after every success, and
at most maxExtraMultiFairySpawns of them can land. That loop is the whole bonus.

What decides when a fairy turns up at all is the QTE cooldown, which this project has not built -
so the one native gate that does not need it is recorded here instead: OnQTEReady refuses the fairy
QTE until the player's best stage reaches fairyStartStage.

This also pins where fairy gold comes from, because the engine had been carrying a guess:
GetFairyGoldAmount starts from MonsterModel.GetChestersonGold, which is GetMonsterGoldDrop with
MonsterClass.Chesterson - so a fairy pays what one treasure titan pays, the same treasureGold x
ChestAmount multiplier, not a separate constant.
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

GET_BONUS = 0x2714C88
METHODS = {
    'multiSpawn': (0x21BDFD4, 'FairyController$$MultiFairySpawn'),
    'gate': (0x21BE368, 'FairyController$$OnQTEReady'),
    'gold': (0x21C11E8, 'FairyController$$GetFairyGoldAmount'),
    'chestersonGold': (0x2327AD0, 'MonsterModel$$GetChestersonGold'),
}
SPAWN_FAIRY = 0x21BE23C  # FairyController$$SpawnFairy, the one MultiFairySpawn calls

STATICS = {0x5C4: ('maxExtraMultiFairySpawns', 'int'),
           0x5C8: ('multiFairySpawnPenalty', 'float'),
           0x5B4: ('fairyStartStage', 'int')}

BONUS_IDS = {'FairySpawnChance': 198, 'AllProbabilityBoost': 27, 'FairyGold': 200,
             'Goldx10Chance': 248, 'ChestGoldx10Chance': 98, 'HandOfMidasSkillAmount': 255}

NOISE = {'get_instance'}

# The QTE type OnQTEReady handles, and the monster class a fairy is paid as.
FAIRY_QTE_TYPE = 6
CHESTERSON_CLASS = 3


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

    def body(address, cap=0x1000):
        following = next((a for a in starts if a > address), address+cap)
        return read(address, min(following-address, cap))

    def fact(address):
        return {'name': symbols[address], 'rva': hex(address), 'bytesSha256': sha(body(address))}

    for key, (address, name) in METHODS.items():
        if symbols.get(address) != name:
            raise ValueError(f'{key}: expected {name} at {address:#x}, found {symbols.get(address)!r}')
    if symbols.get(SPAWN_FAIRY) != 'FairyController$$SpawnFairy':
        raise ValueError(f'SpawnFairy is not at {SPAWN_FAIRY:#x}')

    enum = json.loads((ROOT/'reference/tt2/8.2.0/native-bonus-types.json').read_text(encoding='utf-8'))
    for name, wanted in BONUS_IDS.items():
        if int(enum['values'][name]) != wanted:
            raise ValueError(f'{name} is {enum["values"][name]}, not {wanted}')
    by_id = {value: name for name, value in BONUS_IDS.items()}

    block = re.search(r'^public class ServerVarsModel(?=[\s:])[^\n]*\n\{(.*?)^\}', dump, re.S | re.M).group(1)
    for offset, (field, kind) in STATICS.items():
        if not re.search(r'public static '+kind+' '+field+r'; // 0x'+f'{offset:X}'+r'\b', block):
            raise ValueError(f'{field} is no longer a {kind} at {offset:#x}')
    if not re.search(r'public const MonsterClass Chesterson = '+str(CHESTERSON_CLASS)+r';', dump):
        raise ValueError('MonsterClass.Chesterson moved')

    def trace(address):
        events, pending = [], None
        for ins in machine.disasm(body(address), address):
            if ins.mnemonic == 'mov':
                m = re.fullmatch(r'w1, #(0x[0-9a-f]+|\d+)', ins.op_str)
                pending = int(m.group(1), 0) if m else pending
                m2 = re.fullmatch(r'w([234]), #(\d+)', ins.op_str)
                if m2:
                    events.append(('arg', f'w{m2.group(1)}={m2.group(2)}', hex(ins.address)))
            elif ins.mnemonic == 'ldr':
                m = re.fullmatch(r'[sw]\d+, \[x\d+, #(0x[0-9a-f]+)\]', ins.op_str)
                if m and int(m.group(1), 16) in STATICS:
                    events.append(('static', STATICS[int(m.group(1), 16)][0], hex(ins.address)))
            elif ins.mnemonic in ('fmul', 'fadd', 'fcmp', 'scvtf', 'cmp'):
                events.append((ins.mnemonic, ins.op_str, hex(ins.address)))
            elif ins.mnemonic == 'add' and ins.op_str.startswith('w'):
                # Integer adds only - `add x8, sp, #..` is a stack address, not arithmetic.
                events.append((ins.mnemonic, ins.op_str, hex(ins.address)))
            elif ins.mnemonic == 'bl' and ins.op_str.startswith('#'):
                target = int(ins.op_str.lstrip('#'), 16)
                name = symbols.get(target, '')
                short = name.split('$$')[-1]
                if target == GET_BONUS:
                    events.append(('GetBonus', by_id.get(pending, f'BonusType#{pending}'), hex(ins.address)))
                elif name and short not in NOISE:
                    events.append(('call', short, hex(ins.address)))
        return events

    traces = {key: trace(address) for key, (address, _) in METHODS.items()}

    def kinds(key, keep=None):
        return [(a, b) for a, b, _ in traces[key] if keep is None or a in keep]

    def want(key, expected, keep=None):
        got = kinds(key, keep)
        if got != expected:
            raise ValueError(f'{key} changed shape:\n  got      {got}\n  expected {expected}')

    # --- the multi-fairy loop ---
    want('multiSpawn', [
        ('call', 'SpawnFairy'), ('GetBonus', 'FairySpawnChance'),
        ('GetBonus', 'AllProbabilityBoost'), ('call', 'op_Multiply'),
        ('static', 'maxExtraMultiFairySpawns'), ('cmp', 'w24, w8'),
        ('call', 'get_value'), ('call', 'op_Implicit'), ('call', 'op_LessThan'),
        ('scvtf', 's0, w24, #1'), ('call', 'Invoke'),
        ('static', 'multiFairySpawnPenalty'), ('call', 'op_Implicit'), ('call', 'op_Multiply'),
        ('add', 'w24, w24, #1')],
        keep={'call', 'GetBonus', 'static', 'cmp', 'scvtf', 'add'})

    # The first fairy is spawned before the loop and before any roll, so it is unconditional.
    first_call = next(at for a, b, at in traces['multiSpawn'] if b == 'SpawnFairy')
    first_roll = next(at for a, b, at in traces['multiSpawn'] if b == 'get_value')
    if int(first_call, 16) >= int(first_roll, 16):
        raise ValueError('the first fairy is no longer spawned before the roll')

    # --- the one gate that does not need the QTE system ---
    # The gate ends in the call it guards, which is what makes it a gate and not just a comparison.
    want('gate', [('cmp', f'w20, #{FAIRY_QTE_TYPE}'), ('call', 'GetMaxStageReached'),
                  ('static', 'fairyStartStage'), ('cmp', 'w20, w8'), ('call', 'MultiFairySpawn')],
         keep={'call', 'static', 'cmp'})

    # --- fairy gold is a treasure titan's gold ---
    # The whole chain is recorded, including the four factors this project does not implement,
    # so "we only did the first part" stays a stated limit rather than a silent omission.
    want('gold', [
        ('call', 'GetChestersonGold'), ('call', 'GetStageScaleGoldAmount'), ('call', 'Pow'),
        ('call', 'op_Multiply'),
        ('call', 'GetAverage10xGold'), ('call', 'op_Implicit'), ('call', 'op_Multiply'),
        ('call', 'GetAverage10xGold'), ('call', 'op_Implicit'), ('call', 'op_Multiply'),
        ('call', 'GetAverageJackpotGold'), ('call', 'op_Multiply'),
        ('GetBonus', 'FairyGold'), ('call', 'op_Multiply'),
        ('call', 'IsSkillActive'), ('call', 'get_Value'), ('call', 'GetMaxHandOfMidasBonus'),
        ('GetBonus', 'HandOfMidasSkillAmount'), ('call', 'Pow'), ('call', 'op_Multiply'),
        ('call', 'Range'), ('call', 'op_Implicit'), ('call', 'op_Multiply')],
        keep={'call', 'GetBonus'})
    # ... and GetChestersonGold is just GetMonsterGoldDrop with the Chesterson class and one titan.
    want('chestersonGold', [('arg', f'w2={CHESTERSON_CLASS}'), ('arg', 'w3=1'),
                            ('call', 'GetMonsterGoldDrop')],
         keep={'arg', 'call'})

    servervars = json.loads((ROOT/'reference/tt2/8.2.0/servervar-defaults.json')
                            .read_text(encoding='utf-8'))['recovered']
    statics = {}
    for field, _ in STATICS.values():
        if field not in servervars:
            raise ValueError(f'{field} has no recovered default')
        statics[field] = servervars[field]['value']

    # FairySpawnChance has no entry in SetDefaultBonuses, so its base really is zero.
    defaults = json.loads((ROOT/'reference/tt2/8.2.0/bonus-defaults-evidence.json')
                          .read_text(encoding='utf-8'))['defaults']
    if 'FairySpawnChance' in defaults:
        raise ValueError('FairySpawnChance now has a compiled-in base; the loop below assumes zero')

    extras = statics['maxExtraMultiFairySpawns']
    penalty = statics['multiFairySpawnPenalty']
    start = statics['fairyStartStage']
    document = {
        'version': '8.2.0',
        'role': '多重妖精：一隻必定出現，之後的每一隻各擲一次骰、機率逐次減半；'
                '以及妖精的關卡門檻與金幣來源。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': 'FairyController.MultiFairySpawn 先無條件 SpawnFairy 一隻，'
                   '再以 FairySpawnChance × AllProbabilityBoost 為機率跑一個迴圈：'
                   f'每一輪擲一次 Random.value，沒中就結束，中了就排一隻額外的妖精'
                   f'（延遲 n ÷ 2 秒），然後把機率乘上 multiFairySpawnPenalty（{penalty}）再繼續，'
                   f'最多 maxExtraMultiFairySpawns（{extras}）隻。'
                   '所以這個加成是「額外幾隻」，不是「多久出現一隻」——'
                   'FairySpawnChance 在 SetDefaultBonuses 裡沒有條目，基礎值就是 0，'
                   '沒有來源的玩家永遠只有一隻。'
                   f'什麼時候出現由 QTE 冷卻決定，本專案沒有那套系統；'
                   f'唯一不需要它的原生條件記在這裡：OnQTEReady 對妖精那一型（QTEType {FAIRY_QTE_TYPE}）'
                   f'要求 GetMaxStageReached() ≥ fairyStartStage（{start}）。'
                   '妖精的金幣以 MonsterModel.GetChestersonGold 起算，而那個方法就是 '
                   'GetMonsterGoldDrop(關卡, MonsterClass.Chesterson, 1 隻, 變異)——'
                   '也就是說一隻妖精給的是一隻寶箱泰坦的金幣，走同一個 treasureGold × ChestAmount。',
        'consequence': '引擎的妖精金幣把寶箱那條的倍率寫死成 10，但兩者在原生是同一條，'
                       '所以 2.18.0 把寶箱改成 treasureGold=15 之後，妖精這條也要跟著改。'
                       '多重妖精則是全新的：未投資的人完全沒有變化（基礎值 0），'
                       '有來源的人一次領取會拿到好幾份。',
        'methods': {key: fact(address) for key, (address, _) in METHODS.items()},
        'formulas': {
            'firstFairy': '無條件生成一隻',
            'extraFairies': '重複最多 maxExtraMultiFairySpawns 次：Random.value < 機率就再生一隻，'
                            '然後機率 ×= multiFairySpawnPenalty；沒中就結束',
            'extraChance': 'FairySpawnChance × AllProbabilityBoost（基礎值 0）',
            'stageGate': 'GetMaxStageReached() ≥ fairyStartStage',
            'fairyGold': '一隻寶箱泰坦的金幣（GetMonsterGoldDrop 帶 MonsterClass.Chesterson、1 隻）'
                         ' × 關卡縮放 × 十倍金幣期望值 × 寶箱十倍金幣期望值 × 累積金幣期望值'
                         ' × FairyGold × 點石成金加成（技能開著時）× 隨機變異',
        },
        'traces': traces,
        'statics': {field: {'offset': hex(offset), 'value': statics[field]}
                    for offset, (field, _) in STATICS.items()},
        'bonusIds': BONUS_IDS,
        'limits': [
            '機率沒有被夾在 1：原生就是 op_LessThan(Random.value, 機率)，'
            '機率大於 1 時那一輪必中（天賦「妖精魅力」滿級是 2.75），之後才被 0.5 拉下來。',
            '額外妖精的 n ÷ 2 秒延遲是畫面上的出場間隔，本專案沒有場上實體，因此不實作。',
            '妖精什麼時候出現由 QTEController 的冷卻決定，那是一個 334 條指令、'
            '八個以上加成、依 QTE 類型分支的方法，加上整套 ready／expire 狀態機與點擊互動，'
            '不在本文件範圍內。本專案的妖精仍然是玩家自己按、60 秒冷卻。',
            '妖精金幣的完整鏈記在 traces.gold 裡，本專案只實作了「以寶箱泰坦的金幣起算」'
            '與 FairyGold、GoldSpecialty 這幾項。沒有實作的有四項：'
            'GetStageScaleGoldAmount 的關卡縮放（fairyGoldStageScaleExpo = 1.6）、'
            '兩個十倍金幣與一個累積金幣的期望值（本專案沒有 Goldx10Chance 的來源，'
            '而 JackpotGold 目前是無條件套用）、'
            '點石成金開著時的額外加成，以及 fairyMinGoldVariance（0.2）到 '
            'fairyMaxGoldVariance（1.8）之間的隨機變異——'
            '那個變異的期望值是 1.0，所以略過它不會讓長期收益偏移，但單次金額會比原生穩定。',
            '妖精的獎勵不只金幣（鑽石、裝備、魔力藥水、增益等各有 CanSpawn 條件與每日上限），'
            '本專案目前只有金幣，那些不在本文件範圍內。',
        ],
    }
    out = ROOT/'reference/tt2/8.2.0/fairy-evidence.json'
    out.write_bytes((json.dumps(document, ensure_ascii=False, indent=2)+'\n').encode('utf-8'))
    print(f'wrote {out.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
