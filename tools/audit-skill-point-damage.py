"""Check how the native game turns collected skill points into damage.

RefreshSkillPointBonuses does not apply a bonus - it computes one and writes it into AllDamage
through ModifyBonus, twice: an additive term, 1 + points x Bonus(DamagePerSkillPoint), and an
exponential one, Bonus(DamagePerSkillPointMult) ^ points. Which bonus each ModifyBonus targets is
the part that decides where the term lands, so the target is read the same way the id of a GetBonus
is: by walking back from the call to the nearest immediate in w1.

The count is the other half. It comes from skillPointsReceivedServer, an ObscuredInt at 0x300 on
PlayerModel - points collected, not points left unspent - so the field name is verified against the
dump rather than assumed from the method name.
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

REFRESH_SKILL_POINTS = 0x23DBBEC
GET_BONUS = 0x2714C88
MODIFY_BONUS = 0x27152AC

IDENTITIES = {
    REFRESH_SKILL_POINTS: 'PlayerModel$$RefreshSkillPointBonuses',
    GET_BONUS: 'BonusModel$$GetBonus',
    MODIFY_BONUS: 'BonusModel$$ModifyBonus',
}

ALL_DAMAGE = 37
DAMAGE_PER_SKILL_POINT = 163
DAMAGE_PER_SKILL_POINT_MULT = 164

# PlayerModel's skill point count, as declared in the dump.
POINTS_FIELD = 'skillPointsReceivedServer'
POINTS_OFFSET = 0x300


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
    following = {a: b for a, b in zip(starts, starts[1:])}
    elf = ELFFile(io.BytesIO(binary))
    machine = Cs(CS_ARCH_ARM64, CS_MODE_ARM)

    start = REFRESH_SKILL_POINTS
    end = following[start]
    segment = next(s for s in elf.iter_segments()
                   if s['p_type'] == 'PT_LOAD' and s['p_vaddr'] <= start
                   and end <= s['p_vaddr'] + s['p_filesz'])
    body = binary[start - segment['p_vaddr'] + segment['p_offset']:][:end - start]
    instructions = list(machine.disasm(body, start))
    words = struct.unpack_from(f'<{len(body)//4}I', body, 0)
    text = [f'{i.mnemonic} {i.op_str}' for i in instructions]

    def bl_target(word, address):
        if word >> 26 != 0b100101:
            return None
        offset = word & 0x3FFFFFF
        if offset & 0x2000000:
            offset -= 0x4000000
        return address + offset*4

    def argument_before(index):
        """The immediate last written into w1 before the call at this index, or None."""
        for step in range(1, 17):
            if index - step < 0:
                return None
            previous, at = words[index-step], start + (index-step)*4
            if bl_target(previous, at) is not None:
                return None
            if previous >> 24 == 0x52 and (previous & 0x1F) == 1:
                return (previous >> 5) & 0xFFFF
        return None

    calls = []
    for index, word in enumerate(words):
        target = bl_target(word, start + index*4)
        if target in (GET_BONUS, MODIFY_BONUS):
            calls.append({'call': IDENTITIES[target], 'at': hex(start + index*4),
                          'bonus': argument_before(index)})

    reads = [c['bonus'] for c in calls if c['call'] == 'BonusModel$$GetBonus']
    writes = [c['bonus'] for c in calls if c['call'] == 'BonusModel$$ModifyBonus']
    if reads != [DAMAGE_PER_SKILL_POINT, DAMAGE_PER_SKILL_POINT_MULT]:
        raise ValueError(f'the bonuses read changed: {reads}')
    if writes != [ALL_DAMAGE, ALL_DAMAGE]:
        raise ValueError(f'the terms no longer both land on AllDamage: {writes}')

    named = {by_address.get(bl_target(word, start + index*4))
             for index, word in enumerate(words) if bl_target(word, start + index*4) in by_address}
    for name in ('GHDouble$$op_Multiply', 'GHDouble$$op_Addition', 'GHDouble$$Pow',
                 'CodeStage.AntiCheat.ObscuredTypes.ObscuredInt$$op_Implicit'):
        if name not in named:
            raise ValueError(f'RefreshSkillPointBonuses no longer calls {name}')
    if not any(re.fullmatch(r'fmov s\d+, #1\.00000000', line) for line in text):
        raise ValueError('the additive term no longer starts from 1')

    # The count: confirm the field this method reads is the collected-points one.
    dump = (LOCAL/'dump/dump.cs').read_text(encoding='utf-8', errors='replace')
    declaration = re.search(rf'<({POINTS_FIELD})>k__BackingField; // {POINTS_OFFSET:#x}', dump)
    if not declaration:
        raise ValueError(f'{POINTS_FIELD} is no longer the field at {POINTS_OFFSET:#x}')
    if not any(re.fullmatch(rf'ldr x\d+, \[x\d+, #{POINTS_OFFSET:#x}\]', line) for line in text):
        raise ValueError(f'RefreshSkillPointBonuses no longer reads the field at {POINTS_OFFSET:#x}')

    document = {
        'version': '8.2.0',
        'role': '技能點怎麼變成傷害：原生把它算成 AllDamage 的兩個乘數，不是直接拿來用。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': 'PlayerModel.RefreshSkillPointBonuses 讀 DamagePerSkillPoint 與 DamagePerSkillPointMult，'
                   '算出兩個值之後各呼叫一次 BonusModel.ModifyBonus，**兩次的目標都是 AllDamage**。'
                   '加法項是 1 ＋ 技能點 × Bonus(DamagePerSkillPoint)（一次乘法、一次加法，起點是常數 1）；'
                   '次方項是 Bonus(DamagePerSkillPointMult) ^ 技能點。'
                   f'技能點取的是 {POINTS_FIELD}（PlayerModel 的 ObscuredInt，位移 {POINTS_OFFSET:#x}），'
                   '也就是**累計收到的**點數，不是還沒花掉的那些。',
        'expression': 'AllDamage ×= 1 + 累計技能點 × DamagePerSkillPoint；'
                      'AllDamage ×= DamagePerSkillPointMult ^ 累計技能點',
        'methods': {name: hex(address) for address, name in IDENTITIES.items()},
        'calls': calls,
        'pointSource': {'field': POINTS_FIELD, 'offset': hex(POINTS_OFFSET), 'type': 'ObscuredInt',
                        'meaning': '累計收到的技能點（持有中的加上已投入天賦的）'},
        'consequence': '本專案只接了加法項：DamagePerSkillPointMult 沒有任何來源會給，'
                       '而查一個不在加成表裡的加成會拿到乘法中性值 1，所以不接比接了安全。'
                       '加法項目前唯一拿得到的來源是「小丑女王」傳說套裝（每點 +10%）——'
                       '另一個來源「復仇者」武器是 Unique 稀有度，不在掉落池（只掉 rarity 1）、'
                       'craftSet 也只接受 Mythic／Legendary／Rare，所以本專案還沒有取得途徑。',
        'limits': ['方法存在、位址、它的呼叫與參數是事實；ModifyBonus 的目標以「從呼叫往回找 w1 的立即數」判定',
                   '本表只涵蓋技能點這一條，AllDamage 還有其他來源會改寫'],
    }
    target = ROOT/'reference/tt2/8.2.0/skill-point-damage-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Verified the skill-point damage terms: {len(reads)} bonuses read, '
          f'{len(writes)} written into AllDamage, count from {POINTS_FIELD}')


if __name__ == '__main__':
    main()
