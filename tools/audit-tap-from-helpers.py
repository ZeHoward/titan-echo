"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

Tap damage is two terms, not one. PlayerModel.GetTapDamage adds GetSwordMasterDamage to
GetTapFromHelpers, and the second term is the hero-to-tap conversion: the TapDamage bonus times the
helper DPS raised to a per-conversion power, times TapDamageFromHelpers and its multiplier, floored
at zero. The exponent is the part that is easy to miss and impossible to guess - without it the
conversion is orders of magnitude too large - so this records which server variable supplies it for
each conversion, and that the Sword Master branch skips the Pow its siblings take.
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

GET_TAP_DAMAGE = 0x23E3940
GET_TAP_FROM_HELPERS = 0x23E3A14
GET_ALL_HELPER_DPS = 0x2248B2C
GET_SWORD_MASTER = 0x23E272C

IDENTITIES = {
    GET_TAP_DAMAGE: 'PlayerModel$$GetTapDamage',
    GET_TAP_FROM_HELPERS: 'PlayerModel$$GetTapFromHelpers',
    GET_ALL_HELPER_DPS: 'HelperModel$$GetAllHelperDPS',
    GET_SWORD_MASTER: 'PlayerModel$$GetSwordMasterDamage',
}

TAP_DAMAGE = 0x1C9              # BonusType.TapDamage
FROM_HELPERS = 0x1CA            # BonusType.TapDamageFromHelpers
FROM_HELPERS_MULT = 0x1CB       # BonusType.TapDamageFromHelpersMult

# HelperDamageConversion -> the ServerVarsModel offset holding that conversion's exponent.
# Sword Master is the one this project needs; the others are here so a renumbering fails loudly.
CONVERSION_POWERS = {'SwordMaster': 0x700, 'ShadowClone': 0x708}
# The Sword Master branch of GetTapFromHelpers writes GetBonus(TapDamage) straight into the slot the
# Pow result would occupy and jumps over the Pow, so its own factor is the bonus with no exponent.
SWORD_MASTER_SKIPS_POW = True


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
    text = lambda start: [f'{i.mnemonic} {i.op_str}' for i in decode(start)]

    def calls(start):
        out = []
        for instruction in decode(start):
            if instruction.mnemonic in ('bl', 'b') and instruction.op_str.startswith('#'):
                name = by_address.get(int(instruction.op_str.lstrip('#'), 16))
                if name:
                    out.append(name)
        return out

    # GetTapDamage is exactly the two terms and one addition.
    top = calls(GET_TAP_DAMAGE)
    for name in (IDENTITIES[GET_SWORD_MASTER], IDENTITIES[GET_TAP_FROM_HELPERS], 'GHDouble$$op_Addition'):
        if name not in top:
            raise ValueError(f'GetTapDamage no longer uses {name}')
    if any('op_Multiply' in name or 'op_Subtraction' in name for name in top):
        raise ValueError('GetTapDamage is no longer a plain sum of the two terms')

    # The conversion term: three bonuses, three multiplies, one floor.
    conversion = text(GET_TAP_FROM_HELPERS)
    for number, label in ((TAP_DAMAGE, 'TapDamage'), (FROM_HELPERS, 'TapDamageFromHelpers'),
                          (FROM_HELPERS_MULT, 'TapDamageFromHelpersMult')):
        if not any(re.fullmatch(rf'mov w1, #{number:#x}', line) for line in conversion):
            raise ValueError(f'GetTapFromHelpers no longer reads {label}')
    called = calls(GET_TAP_FROM_HELPERS)
    if called.count('GHDouble$$op_Multiply') != 3:
        raise ValueError(f'the conversion is no longer three multiplies: {called.count("GHDouble$$op_Multiply")}')
    for name in ('HelperModel$$GetAllHelperDPS', 'GHDouble$$Max', 'GHDouble$$Pow'):
        if name not in called:
            raise ValueError(f'GetTapFromHelpers no longer uses {name}')

    # The Sword Master branch writes the bonus into the Pow's own output slot and jumps past it.
    pow_sites = [i.address for i in decode(GET_TAP_FROM_HELPERS)
                 if i.mnemonic == 'bl' and i.op_str.startswith('#')
                 and by_address.get(int(i.op_str.lstrip('#'), 16)) == 'GHDouble$$Pow']
    if len(pow_sites) != 1:
        raise ValueError(f'expected one Pow in the conversion, found {len(pow_sites)}')
    after_pow = pow_sites[0] + 4
    jumps_over = [i for i in decode(GET_TAP_FROM_HELPERS)
                  if i.mnemonic == 'b' and i.op_str == f'#{after_pow:#x}']
    if SWORD_MASTER_SKIPS_POW and not jumps_over:
        raise ValueError('no branch jumps over the Pow any more, so a conversion lost its shortcut')

    # The exponents, by conversion, cross-checked against the recovered defaults.
    helper_dps = text(GET_ALL_HELPER_DPS)
    defaults = json.loads((ROOT/'reference/tt2/8.2.0/servervar-defaults.json')
                          .read_text(encoding='utf-8'))['recovered']
    by_offset = {int(fact['offset'], 16): (name, fact) for name, fact in defaults.items()}
    powers = {}
    for conversion_name, offset in CONVERSION_POWERS.items():
        if not any(re.fullmatch(rf'ldr d\d+, \[x\d+, #{offset:#x}\]', line) for line in helper_dps):
            raise ValueError(f'GetAllHelperDPS no longer reads {offset:#x} for {conversion_name}')
        if offset not in by_offset:
            raise ValueError(f'no recovered server variable at {offset:#x}')
        name, fact = by_offset[offset]
        powers[conversion_name] = {'serverVar': name, 'offset': fact['offset'],
                                   'type': fact['type'], 'defaultValue': fact['value'],
                                   'status': 'default'}
    if 'GHDouble$$Pow' not in calls(GET_ALL_HELPER_DPS):
        raise ValueError('GetAllHelperDPS no longer raises the helper DPS to a power')
    if powers['SwordMaster']['serverVar'] != 'helperToTapDPSPower':
        raise ValueError('the Sword Master exponent is no longer helperToTapDPSPower')

    document = {
        'version': '8.2.0',
        'role': '英雄轉點擊：點擊傷害是「劍術大師傷害」加「英雄轉換」兩項，轉換帶一個逐對象的指數。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': 'PlayerModel.GetTapDamage(等級, 轉換對象) = GetSwordMasterDamage(等級) ＋ GetTapFromHelpers(轉換對象)，'
                   '只有一個加法，沒有別的運算。GetTapFromHelpers 是 '
                   'Max(0, 該轉換的係數 × GetAllHelperDPS(轉換對象) × TapDamageFromHelpers × TapDamageFromHelpersMult)，'
                   '三次乘法、一次取下限。',
        'expression': 'tapDamage = 劍術大師傷害 + max(0, TapDamage 加成 × 英雄 DPS^指數 '
                      '× TapDamageFromHelpers × TapDamageFromHelpersMult)',
        'methods': {name: hex(address) for address, name in IDENTITIES.items()},
        'bonuses': {'factor': 'TapDamage', 'share': 'TapDamageFromHelpers',
                    'multiplier': 'TapDamageFromHelpersMult'},
        'conversionPowers': powers,
        'swordMasterFactor': '劍術大師那一支把 GetBonus(TapDamage) 直接寫進 Pow 的輸出槽並跳過 Pow，'
                             '所以它自己的係數就是那個加成，沒有再取次方；'
                             '指數是在 GetAllHelperDPS 裡套到英雄 DPS 上的。',
        'consequence': '指數 0.5 是這條算式的關鍵：少了它，轉換出來的點擊傷害會高出好幾個數量級。'
                       '本專案的 TapDamageFromHelpers 目前只有神器「大師之劍」會給，'
                       '倍率只有天賦 TapDmgFromHelpers 會給；兩者都是 0 時這一項是 0，點擊傷害不變。',
        'limits': ['方法存在、位址與其呼叫是事實；指數引用的是編譯期預設值，線上可覆蓋',
                   '本表只涵蓋劍術大師與影分身兩個轉換對象，匕首與金槍的流派尚未實作'],
    }
    target = ROOT/'reference/tt2/8.2.0/tap-from-helpers-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print('Verified the hero-to-tap conversion: '
          f'{len(powers)} conversion exponents, Sword Master uses '
          f'{powers["SwordMaster"]["serverVar"]} = {powers["SwordMaster"]["defaultValue"]}')


if __name__ == '__main__':
    main()
