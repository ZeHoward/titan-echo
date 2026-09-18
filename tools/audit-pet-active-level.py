"""Check the extra levels a pet gets for being the one that is out.

PetInfo.GetActiveLevelBonus checks IsEquippedPet, takes the pet's own level, multiplies it by
ActivePetLevel and floors the result. It is an addition to the level, not a replacement of it, and
it only applies while that pet is out - a benched pet keeps the levels it owns.

The floor matters: the bonus is a fraction (0.25 for the samurai set), so a 60-level pet gains 15
levels rather than 15.0-something, and every level step downstream is an integer again.
"""
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

GET_ACTIVE_LEVEL_BONUS = 0x23B0458
GET_BONUS = 0x2714C88
IS_EQUIPPED = 0x23A3590
GET_LEVEL = 0x23AFDFC
FLOOR = 0x21E004C
MULTIPLY = 0x21DD6EC

IDENTITIES = {
    GET_ACTIVE_LEVEL_BONUS: 'PetInfo$$GetActiveLevelBonus',
    GET_BONUS: 'BonusModel$$GetBonus',
    IS_EQUIPPED: 'PetModel$$IsEquippedPet',
    GET_LEVEL: 'PetInfo$$get_Level',
    FLOOR: 'GHDouble$$Floor',
    MULTIPLY: 'GHDouble$$op_Multiply',
}
ACTIVE_PET_LEVEL = 35


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
    if int(types['values']['ActivePetLevel']) != ACTIVE_PET_LEVEL:
        raise ValueError(f'ActivePetLevel is no longer {ACTIVE_PET_LEVEL}')

    starts = sorted(by_address)
    following = {a: b for a, b in zip(starts, starts[1:])}
    elf = ELFFile(io.BytesIO(binary))
    machine = Cs(CS_ARCH_ARM64, CS_MODE_ARM)

    start = GET_ACTIVE_LEVEL_BONUS
    end = following[start]
    segment = next(s for s in elf.iter_segments()
                   if s['p_type'] == 'PT_LOAD' and s['p_vaddr'] <= start
                   and end <= s['p_vaddr'] + s['p_filesz'])
    body = binary[start - segment['p_vaddr'] + segment['p_offset']:][:end - start]
    words = struct.unpack_from(f'<{len(body)//4}I', body, 0)

    def bl_target(word, address):
        if word >> 26 != 0b100101:
            return None
        offset = word & 0x3FFFFFF
        if offset & 0x2000000:
            offset -= 0x4000000
        return address + offset*4

    called, bonus = [], None
    for index, word in enumerate(words):
        target = bl_target(word, start + index*4)
        if target in by_address:
            called.append(by_address[target])
        if target == GET_BONUS:
            for step in range(1, 17):
                if index - step < 0:
                    break
                previous, at = words[index-step], start + (index-step)*4
                if bl_target(previous, at) is not None:
                    break
                if previous >> 24 == 0x52 and (previous & 0x1F) == 1:
                    bonus = (previous >> 5) & 0xFFFF
                    break

    if bonus != ACTIVE_PET_LEVEL:
        raise ValueError(f'the bonus read is no longer ActivePetLevel: {bonus}')
    for name in ('PetModel$$IsEquippedPet', 'PetInfo$$get_Level', 'GHDouble$$Floor'):
        if name not in called:
            raise ValueError(f'GetActiveLevelBonus no longer calls {name}')
    if called.count('GHDouble$$op_Multiply') != 1:
        raise ValueError('the extra levels are no longer a single multiply')
    if 'GHDouble$$op_Addition' in called:
        raise ValueError('GetActiveLevelBonus gained an addition; it returns the bonus alone')

    document = {
        'version': '8.2.0',
        'role': '出戰中的寵物多拿幾級：等級乘上加成再無條件捨去。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': 'PetInfo.GetActiveLevelBonus 先用 PetModel.IsEquippedPet 判斷這隻有沒有出戰，'
                   '再取牠自己的等級乘上 Bonus(ActivePetLevel)，最後 Floor。'
                   '回傳的是**額外的等級**（方法本身沒有加法），不是取代原本的等級；'
                   '沒有出戰的寵物維持自己擁有的等級。',
        'expression': '出戰寵物的有效等級 = 擁有等級 + floor(擁有等級 × ActivePetLevel)',
        'methods': {name: hex(address) for address, name in IDENTITIES.items()},
        'bonus': 'ActivePetLevel',
        'consequence': '本專案在 petBonus 裡對出戰中的寵物套用這幾級。'
                       '來源是「武士」神話套裝（0.25）、「九尾」傳說套裝（0.1）與天賦「戰鬥技巧」，'
                       '三者都拿得到；60 級的出戰寵物配武士套裝等於 75 級。'
                       '**取值走 baseFrom 而不是 effect()**：完整快取本身就是在算寵物加成時呼叫 petBonus 的，'
                       '從那裡再呼叫 effect() 會繞回自己；而且沒有任何寵物會給 ActivePetLevel，'
                       '所以只讀基礎層既足夠也不會遞迴。',
        'limits': ['方法存在、位址、它呼叫的方法與讀的加成是事實',
                   '「額外等級」的判定依據是這個方法本身沒有加法運算，加總發生在呼叫端',
                   '本表不涵蓋呼叫端怎麼把這幾級併進寵物的其他數值'],
    }
    target = ROOT/'reference/tt2/8.2.0/pet-active-level-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print('Verified the active-pet level bonus: equipped check, one multiply by ActivePetLevel, floored')


if __name__ == '__main__':
    main()
