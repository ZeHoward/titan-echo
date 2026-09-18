"""Check two PlayerModel refreshes that turn a player stat into a bonus modifier.

Both read one bonus, compute a value and write it back with ModifyBonus, but they are not the same
shape, and the difference is the whole point:

  RefreshGoldPerPlayerLevelBonus  GoldAll   x= 1 + SwordMasterLevel x GoldPerSwordMasterLevel
  RefreshDamageBonusPerManaCap    AllDamage x= clamp(currentManaCap, 0, cap) x DamagePerManaCap

The second has no leading 1 - the mana cap itself is the multiplier - so it cannot just be applied
unconditionally. Natively it is guarded by comparing the bonus against GetBonusIdentity and removing
the modifier when they match. That guard is load-bearing for a multiplicative bonus, whose identity
is 1 rather than 0: treating 1 as "present" would multiply everyone's damage by their whole mana
cap. This records the presence of the identity check and the absence of the addition, so either one
disappearing fails loudly.
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

GOLD_PER_LEVEL = 0x23DE4C8
DAMAGE_PER_MANA_CAP = 0x23DE6FC
GET_BONUS = 0x2714C88
MODIFY_BONUS = 0x27152AC
REMOVE_BONUS = 0x27159E0
GET_BONUS_IDENTITY = 0x2715858

IDENTITIES = {
    GOLD_PER_LEVEL: 'PlayerModel$$RefreshGoldPerPlayerLevelBonus',
    DAMAGE_PER_MANA_CAP: 'PlayerModel$$RefreshDamageBonusPerManaCap',
    GET_BONUS: 'BonusModel$$GetBonus',
    MODIFY_BONUS: 'BonusModel$$ModifyBonus',
    REMOVE_BONUS: 'BonusModel$$RemoveBonus',
    GET_BONUS_IDENTITY: 'BonusModel$$GetBonusIdentity',
}
WATCHED = {GET_BONUS: 'GetBonus', MODIFY_BONUS: 'ModifyBonus',
           REMOVE_BONUS: 'RemoveBonus', GET_BONUS_IDENTITY: 'GetBonusIdentity'}

ALL_DAMAGE = 37
GOLD_ALL = 214
GOLD_PER_SWORD_MASTER_LEVEL = 243
DAMAGE_PER_MANA_CAP_BONUS = 144

MANA_CAP_FIELD = 'currentManaCap'
MANA_CAP_OFFSET = 0x474
MANA_CAP_LIMIT_VAR = 'maximumManaCapBonusAmount'
MANA_CAP_LIMIT_OFFSET = 0x524


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

    types = json.loads((ROOT/'reference/tt2/8.2.0/native-bonus-types.json').read_text(encoding='utf-8'))
    for label, number in (('AllDamage', ALL_DAMAGE), ('GoldAll', GOLD_ALL),
                          ('GoldPerSwordMasterLevel', GOLD_PER_SWORD_MASTER_LEVEL),
                          ('DamagePerManaCap', DAMAGE_PER_MANA_CAP_BONUS)):
        if int(types['values'][label]) != number:
            raise ValueError(f'{label} is no longer {number}')

    starts = sorted(by_address)
    following = {a: b for a, b in zip(starts, starts[1:])}
    elf = ELFFile(io.BytesIO(binary))
    machine = Cs(CS_ARCH_ARM64, CS_MODE_ARM)

    def bl_target(word, address):
        if word >> 26 != 0b100101:
            return None
        offset = word & 0x3FFFFFF
        if offset & 0x2000000:
            offset -= 0x4000000
        return address + offset*4

    def study(start):
        end = following[start]
        segment = next(s for s in elf.iter_segments()
                       if s['p_type'] == 'PT_LOAD' and s['p_vaddr'] <= start
                       and end <= s['p_vaddr'] + s['p_filesz'])
        body = binary[start - segment['p_vaddr'] + segment['p_offset']:][:end - start]
        words = struct.unpack_from(f'<{len(body)//4}I', body, 0)
        text = [f'{i.mnemonic} {i.op_str}' for i in machine.disasm(body, start)]
        calls, named = [], []
        for index, word in enumerate(words):
            target = bl_target(word, start + index*4)
            if target is None:
                continue
            if target in WATCHED:
                bonus = None
                for step in range(1, 17):
                    if index - step < 0:
                        break
                    previous, at = words[index-step], start + (index-step)*4
                    if bl_target(previous, at) is not None:
                        break
                    if previous >> 24 == 0x52 and (previous & 0x1F) == 1:
                        bonus = (previous >> 5) & 0xFFFF
                        break
                calls.append({'call': WATCHED[target], 'at': hex(start + index*4), 'bonus': bonus})
            if target in by_address:
                named.append(by_address[target])
        return calls, named, text

    gold_calls, gold_named, _ = study(GOLD_PER_LEVEL)
    mana_calls, mana_named, mana_text = study(DAMAGE_PER_MANA_CAP)

    # Gold: read one bonus, multiply by the level, add 1, write into GoldAll.
    if [(c['call'], c['bonus']) for c in gold_calls] != [
            ('GetBonus', GOLD_PER_SWORD_MASTER_LEVEL), ('ModifyBonus', GOLD_ALL)]:
        raise ValueError(f'the gold-per-level shape changed: {gold_calls}')
    for name in ('GHDouble$$op_Multiply', 'GHDouble$$op_Addition',
                 'CodeStage.AntiCheat.ObscuredTypes.ObscuredInt$$op_Implicit'):
        if name not in gold_named:
            raise ValueError(f'RefreshGoldPerPlayerLevelBonus no longer calls {name}')

    # Mana cap: identity check, removal branch, one multiply, no addition.
    shape = [(c['call'], c['bonus']) for c in mana_calls]
    if shape[0] != ('GetBonus', DAMAGE_PER_MANA_CAP_BONUS):
        raise ValueError(f'the mana-cap term no longer starts by reading its bonus: {shape}')
    if ('GetBonusIdentity', DAMAGE_PER_MANA_CAP_BONUS) not in shape:
        raise ValueError('the mana-cap term no longer compares against the bonus identity')
    if not any(call == 'RemoveBonus' for call, _ in shape):
        raise ValueError('the mana-cap term no longer removes its modifier')
    if ('ModifyBonus', ALL_DAMAGE) not in shape:
        raise ValueError(f'the mana-cap term no longer writes into AllDamage: {shape}')
    if 'GHDouble$$op_Equality' not in mana_named:
        raise ValueError('the identity comparison is gone')
    if 'GHDouble$$op_Addition' in mana_named:
        raise ValueError('the mana-cap term gained an addition; it used to be a bare multiply')
    if mana_named.count('GHDouble$$op_Multiply') != 1:
        raise ValueError('the mana-cap term is no longer a single multiply')

    # The mana cap it reads, and the ceiling it is clamped to.
    dump = (LOCAL/'dump/dump.cs').read_text(encoding='utf-8', errors='replace')
    if not re.search(rf'public float {MANA_CAP_FIELD}; // {MANA_CAP_OFFSET:#x}', dump):
        raise ValueError(f'{MANA_CAP_FIELD} is no longer the float at {MANA_CAP_OFFSET:#x}')
    if not any(re.fullmatch(rf'ldr s\d+, \[x\d+, #{MANA_CAP_OFFSET:#x}\]', line) for line in mana_text):
        raise ValueError('RefreshDamageBonusPerManaCap no longer reads currentManaCap')
    defaults = json.loads((ROOT/'reference/tt2/8.2.0/servervar-defaults.json')
                          .read_text(encoding='utf-8'))['recovered']
    limit = defaults.get(MANA_CAP_LIMIT_VAR)
    if not limit or int(limit['offset'], 16) != MANA_CAP_LIMIT_OFFSET:
        raise ValueError(f'{MANA_CAP_LIMIT_VAR} is no longer at {MANA_CAP_LIMIT_OFFSET:#x}')
    if not any(re.fullmatch(rf'ldr s\d+, \[x\d+, #{MANA_CAP_LIMIT_OFFSET:#x}\]', line) for line in mana_text):
        raise ValueError('the mana cap is no longer clamped against maximumManaCapBonusAmount')

    document = {
        'version': '8.2.0',
        'role': '兩個把玩家狀態換算成加成的刷新方法：劍術大師等級對金幣、魔力上限對傷害。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': 'PlayerModel.RefreshGoldPerPlayerLevelBonus 讀 GoldPerSwordMasterLevel，'
                   '乘上劍術大師等級、加 1，寫進 GoldAll。'
                   'PlayerModel.RefreshDamageBonusPerManaCap 讀 DamagePerManaCap，'
                   '**沒有加 1**——直接把夾在 0 與 maximumManaCapBonusAmount（5000）之間的 currentManaCap '
                   '乘上該加成，寫進 AllDamage；而且先用 GetBonusIdentity 比對，'
                   '相等時改成 RemoveBonus 移除修飾、不套用。'
                   '那個 identity 比對是必要的：DamagePerManaCap 是乘法型加成，沒有來源時讀到的是 1 而不是 0，'
                   '把 1 當成「有加成」會讓每個人的傷害乘上自己的整個魔力上限。',
        'expressions': {
            'gold': 'GoldAll ×= 1 + 劍術大師等級 × GoldPerSwordMasterLevel',
            'damage': 'AllDamage ×= clamp(currentManaCap, 0, maximumManaCapBonusAmount) × DamagePerManaCap'
                      '（加成等於它的中性值時整個不套用）',
        },
        'methods': {name: hex(address) for address, name in IDENTITIES.items()},
        'calls': {'gold': gold_calls, 'manaCap': mana_calls},
        'manaCapSource': {'field': MANA_CAP_FIELD, 'offset': hex(MANA_CAP_OFFSET), 'type': 'float'},
        'manaCapLimit': {'serverVar': MANA_CAP_LIMIT_VAR, 'offset': limit['offset'],
                         'defaultValue': limit['value'], 'status': 'default'},
        'consequence': '本專案兩條都接上了。金幣那條的來源是「鑽石」傳說套裝（每級 +0.1%，'
                       '劍術大師滿級 12500 時是 13.5 倍）；傷害那條是「腐化」傳說套裝（每點魔力上限 ×0.05，'
                       '六個技能全解鎖、魔力上限 210 時是 10.5 倍）。兩者都可製作。'
                       '**刻意偏離一處**：原生在魔力上限為 0 時會讓 AllDamage 乘以 0。'
                       '原生的節奏走不到那個狀態，但本專案可以——「腐化」套裝沒有關卡需求，'
                       '存檔可能在劍術大師 100 級（解鎖第一個技能）之前就湊齊它，'
                       '而傷害歸零之後金幣只能靠擊殺取得，等於無法恢復。'
                       '所以魔力上限還是 0 的時候這一項不套用。',
        'limits': ['方法存在、位址、呼叫序列與參數是事實；ModifyBonus 與 RemoveBonus 的目標以'
                   '「從呼叫往回找 w1 的立即數」判定，RemoveBonus 那個以暫存器傳入，故記為 null',
                   '夾擠上限 5000 是編譯期預設值，線上可覆蓋；本專案魔力上限最高 210，夾不到',
                   '魔力上限為 0 時不套用是本專案的刻意偏離，不是原生行為'],
    }
    target = ROOT/'reference/tt2/8.2.0/derived-bonus-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print('Verified two derived bonuses: gold-per-level adds 1 then writes GoldAll; '
          'mana-cap multiplies bare and writes AllDamage, guarded by the bonus identity')


if __name__ == '__main__':
    main()
