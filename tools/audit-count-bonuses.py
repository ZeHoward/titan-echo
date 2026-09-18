"""Check two bonuses that scale with how many of something the player owns.

Same family as the derived bonuses, different arithmetic - and the arithmetic is the point:

  EquipmentSetCountBonusHandler        AllDamage x= DamagePerEquipmentSet ** completed sets
  RefreshDamagePerHelperWeaponBonus    AllDamage x= total weapon levels x DamagePerHelperWeapon

The first raises to a power, the second multiplies, and the second has no leading 1. Its guards are
a zero-count branch and an inequality against GetBonusIdentity; neither covers a small count, so
natively a set granting 0.1 per level is a loss below ten levels. That is recorded rather than
patched, because it is the native behaviour and the player can recover from it.

This also pins a concrete case of the bonus-reader sweep undercounting: the set handler picks its
per-rarity bonus out of a table and passes it in a register, so DamagePerLegendarySet and its
siblings show up in bonus-coverage as "the native game ignores them too" when in fact they are
consumed right here.
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

SET_COUNT_HANDLER = 0x218B8DC
HELPER_WEAPON = 0x2255760
TOTAL_WEAPON_LEVELS = 0x2256844
GET_BONUS = 0x2714C88
MODIFY_BONUS = 0x27152AC
REMOVE_BONUS = 0x27159E0
GET_BONUS_IDENTITY = 0x2715858

IDENTITIES = {
    SET_COUNT_HANDLER: 'EquipmentModel$$EquipmentSetCountBonusHandler',
    HELPER_WEAPON: 'HelperModel$$RefreshDamagePerHelperWeaponBonus',
    TOTAL_WEAPON_LEVELS: 'HelperModel$$GetTotalHelperWeaponLevels',
    GET_BONUS: 'BonusModel$$GetBonus',
    MODIFY_BONUS: 'BonusModel$$ModifyBonus',
    REMOVE_BONUS: 'BonusModel$$RemoveBonus',
    GET_BONUS_IDENTITY: 'BonusModel$$GetBonusIdentity',
}
WATCHED = {GET_BONUS: 'GetBonus', MODIFY_BONUS: 'ModifyBonus',
           REMOVE_BONUS: 'RemoveBonus', GET_BONUS_IDENTITY: 'GetBonusIdentity'}

ALL_DAMAGE = 37
GOLD_ALL = 214
DAMAGE_PER_EQUIPMENT_SET = 143
DAMAGE_PER_HELPER_WEAPON = 152
DAMAGE_PER_HELPER_WEAPON_MULT = 153


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
                          ('DamagePerEquipmentSet', DAMAGE_PER_EQUIPMENT_SET),
                          ('DamagePerHelperWeapon', DAMAGE_PER_HELPER_WEAPON),
                          ('DamagePerHelperWeaponMult', DAMAGE_PER_HELPER_WEAPON_MULT)):
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

    set_calls, set_named, _ = study(SET_COUNT_HANDLER)
    weapon_calls, weapon_named, weapon_text = study(HELPER_WEAPON)

    # Sets: the per-rarity bonuses arrive in a register; the count bonus is named and raised to a power.
    named_reads = [c for c in set_calls if c['call'] == 'GetBonus' and c['bonus'] is not None]
    register_reads = [c for c in set_calls if c['call'] == 'GetBonus' and c['bonus'] is None]
    if [c['bonus'] for c in named_reads] != [DAMAGE_PER_EQUIPMENT_SET]:
        raise ValueError(f'the set handler no longer names exactly one bonus: {named_reads}')
    if not register_reads:
        raise ValueError('the per-rarity reads are no longer register-passed, '
                         'so the undercount example this pins is gone')
    writes = [c['bonus'] for c in set_calls if c['call'] == 'ModifyBonus']
    if writes != [ALL_DAMAGE, GOLD_ALL, ALL_DAMAGE]:
        raise ValueError(f'the set handler no longer writes damage, gold, damage: {writes}')
    if set_named.count('GHDouble$$Pow') != 3:
        raise ValueError('the set handler no longer raises each of its three bonuses to a power')
    if 'GHDouble$$op_Multiply' in set_named:
        raise ValueError('the set count term gained a multiply; it used to be a pure power')

    # Weapons: total levels, identity guard, one multiply, no addition, then the Mult term as a power.
    if 'HelperModel$$GetTotalHelperWeaponLevels' not in weapon_named:
        raise ValueError('the weapon term no longer reads the total weapon levels')
    shape = [(c['call'], c['bonus']) for c in weapon_calls]
    for expected in (('GetBonus', DAMAGE_PER_HELPER_WEAPON),
                     ('GetBonusIdentity', DAMAGE_PER_HELPER_WEAPON),
                     ('GetBonus', DAMAGE_PER_HELPER_WEAPON_MULT),
                     ('GetBonusIdentity', DAMAGE_PER_HELPER_WEAPON_MULT),
                     ('ModifyBonus', ALL_DAMAGE)):
        if expected not in shape:
            raise ValueError(f'the weapon term no longer does {expected}: {shape}')
    if 'GHDouble$$op_Inequality' not in weapon_named:
        raise ValueError('the weapon term no longer guards on the bonus identity')
    if 'GHDouble$$op_Addition' in weapon_named:
        raise ValueError('the weapon term gained an addition; it used to be a bare multiply')
    if weapon_named.count('GHDouble$$op_Multiply') != 1:
        raise ValueError('the weapon term is no longer a single multiply')
    if weapon_named.count('GHDouble$$Pow') != 1:
        raise ValueError('the weapon Mult term is no longer a single power')
    # The zero-count branch: the total is tested straight after it is fetched.
    fetch = next(i for i, line in enumerate(weapon_text)
                 if line.startswith('bl ') and int(line.split('#')[1], 16) == TOTAL_WEAPON_LEVELS)
    if not any(re.fullmatch(r'cbz w\d+, #0x[0-9a-f]+', line) for line in weapon_text[fetch:fetch+6]):
        raise ValueError('the weapon term no longer skips a zero total')

    document = {
        'version': '8.2.0',
        'role': '兩個依「擁有幾個」放大的加成：集齊的裝備套裝數、英雄武器的總等級。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': 'EquipmentModel.EquipmentSetCountBonusHandler 對三個加成各做一次 Pow 再寫回，'
                   '其中具名的那個是 DamagePerEquipmentSet，指數是**集齊的套裝總數**，寫進 AllDamage；'
                   '另外兩個依稀有度從表裡選，以暫存器傳入。'
                   'HelperModel.RefreshDamagePerHelperWeaponBonus 先取 GetTotalHelperWeaponLevels，'
                   '**總等級是 0 就整個跳過**；否則在加成不等於 GetBonusIdentity 時，'
                   '以「總等級 × 加成」寫進 AllDamage——**沒有加 1**，'
                   '接著 DamagePerHelperWeaponMult 以總等級取次方再寫一次。',
        'expressions': {
            'equipmentSets': 'AllDamage ×= DamagePerEquipmentSet ^ 集齊的套裝數',
            'helperWeapons': 'AllDamage ×= 武器總等級 × DamagePerHelperWeapon（總等級為 0 或加成為中性值時不套用）；'
                             'AllDamage ×= DamagePerHelperWeaponMult ^ 武器總等級',
        },
        'methods': {name: hex(address) for address, name in IDENTITIES.items()},
        'calls': {'equipmentSets': set_calls, 'helperWeapons': weapon_calls},
        'sweepUndercount': {
            'note': '這裡是 bonus-readers 掃描會低估的具體實例：套裝處理器依稀有度從表裡取 BonusType '
                    '再以暫存器傳給 GetBonus，所以那些加成在 docs/bonus-coverage.md 會被歸成 '
                    '「原生也沒有取值點」，實際上就在這個方法裡被消費。',
            'registerPassedReads': [c['at'] for c in register_reads],
            'affectedBonuses': ['DamagePerLegendarySet', 'DamagePerMythicSet', 'DamagePerUniqueSet',
                                'GoldPerLegendarySet'],
        },
        'consequence': '本專案兩條都接上了。裝備套裝那條的來源是「鐵匠」傳說套裝（1.19），'
                       '集齊 10 套是 5.69 倍、20 套是 32.4 倍；武器那條是「武器大師」傳說套裝（0.1），'
                       '33 位英雄各 1 級（總 33）是 3.3 倍。兩套都可製作。'
                       '**武器那條在總等級低的時候會讓傷害變低**（總等級 5 時是 ×0.5）——'
                       '原生就是這樣，沒有加 1 也沒有夾下限，而且總等級會一直累積上去，'
                       '玩家自己走得出來，所以照原生保留。'
                       'DamagePerHelperWeaponMult 在本專案沒有任何來源會給，故不接。',
        'limits': ['方法存在、位址、呼叫序列與具名參數是事實；以暫存器傳入的參數記為 null',
                   '「總等級低於門檻會變弱」是原生行為，不是本專案的取捨',
                   '本表不涵蓋套裝處理器裡那兩個依稀有度選出的加成，它們的身分要另外從選表的邏輯解'],
    }
    target = ROOT/'reference/tt2/8.2.0/count-bonus-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print('Verified two count-scaled bonuses: equipment sets use a power, helper weapons a bare '
          f'multiply; {len(register_reads)} register-passed reads pinned as the sweep undercount case')


if __name__ == '__main__':
    main()
