"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

DamagePerConsecutiveLoginDay has exactly one reader, and it is not a plain multiplier: the streak is
the exponent, the bonus is the base, and the whole term is switched off the moment a day is missed.
DailyRewardModel.GetCollected is what decides that - it compares the date of the last collection
with today and returns one of four states, and the bonus only applies for the two that mean "the
streak is intact".

This pins all of it instruction by instruction:

  * GetCollected      - collected today, collectable today, missed (reset), or error
  * LoginStreak       - currentDayNumber - 1
  * LoginStreakCapped - that, clamped to [0, NUMBER_OF_DAYS]
  * the bonus         - AllDamage x= Pow(bonus, intact ? capped streak : 0)

The clamp matters as much as the exponent: the bonus's own description says "max 14", and the cap
comes from NUMBER_OF_DAYS, the same constant the fourteen-day reward table is built on.
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
    'bonus': (0x21377C4, 'DailyRewardModel$$UpdateBonusPerConsecutiveLoginDay'),
    'state': (0x21371DC, 'DailyRewardModel$$GetCollected'),
    'streak': (0x213790C, 'DailyRewardModel$$get_LoginStreak'),
    'capped': (0x2137918, 'DailyRewardModel$$get_LoginStreakCapped'),
}

BONUS_IDS = {'DamagePerConsecutiveLoginDay': 142, 'AllDamage': 37}

NOISE = {'get_instance'}

# DailyRewardState, checked against dump.cs rather than assumed.
STATES = {'CAN_COLLECT_TODAY': 0, 'COLLECTED_TODAY': 1, 'MISSED_COLLECT_RESET': 2, 'ERROR': 3}
NUMBER_OF_DAYS = 14
CURRENT_DAY_FIELD = 0x20


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

    def body(address, cap=0x400):
        following = next((a for a in starts if a > address), address+cap)
        return read(address, min(following-address, cap))

    def fact(address):
        return {'name': symbols[address], 'rva': hex(address), 'bytesSha256': sha(body(address))}

    for key, (address, name) in METHODS.items():
        if symbols.get(address) != name:
            raise ValueError(f'{key}: expected {name} at {address:#x}, found {symbols.get(address)!r}')

    enum = json.loads((ROOT/'reference/tt2/8.2.0/native-bonus-types.json').read_text(encoding='utf-8'))
    for name, wanted in BONUS_IDS.items():
        if int(enum['values'][name]) != wanted:
            raise ValueError(f'{name} is {enum["values"][name]}, not {wanted}')
    by_id = {value: name for name, value in BONUS_IDS.items()}

    # The four states and the fourteen-day cap both come from dump.cs, so fail if either moved.
    for name, value in STATES.items():
        if not re.search(r'public const DailyRewardState '+name+r' = '+str(value)+r';', dump):
            raise ValueError(f'DailyRewardState.{name} is no longer {value}')
    if not re.search(r'public const int NUMBER_OF_DAYS = '+str(NUMBER_OF_DAYS)+r';', dump):
        raise ValueError(f'NUMBER_OF_DAYS is no longer {NUMBER_OF_DAYS}')
    if not re.search(r'private int currentDayNumber; // 0x'+f'{CURRENT_DAY_FIELD:X}'+r'\b', dump):
        raise ValueError(f'currentDayNumber is no longer at {CURRENT_DAY_FIELD:#x}')

    def trace(address):
        events, pending = [], None
        for ins in machine.disasm(body(address), address):
            if ins.mnemonic == 'mov':
                m = re.fullmatch(r'w1, #(0x[0-9a-f]+|\d+)', ins.op_str)
                pending = int(m.group(1), 0) if m else pending
                m2 = re.fullmatch(r'w\d+, #(0x[0-9a-f]+|\d+)', ins.op_str)
                if m2:
                    events.append(('const', ins.op_str, hex(ins.address)))
            elif ins.mnemonic == 'ldr':
                m = re.fullmatch(r'w\d+, \[x\d+, #(0x[0-9a-f]+)\]', ins.op_str)
                if m and int(m.group(1), 16) == CURRENT_DAY_FIELD:
                    events.append(('field', 'currentDayNumber', hex(ins.address)))
            elif ins.mnemonic in ('sub', 'cmp', 'csel', 'cinc', 'bic', 'scvtf', 'fmov'):
                # `sub sp, sp, #..` is the prologue reserving stack, not arithmetic.
                if not ins.op_str.startswith('sp,'):
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

    # --- the streak is the day number minus one, capped at NUMBER_OF_DAYS ---
    want('streak', [('field', 'currentDayNumber'), ('sub', 'w0, w8, #1')],
         keep={'field', 'sub'})
    want('capped', [('field', 'currentDayNumber'), ('const', f'w8, #0x{NUMBER_OF_DAYS:x}'),
                    ('sub', 'w9, w9, #1'), ('cmp', f'w9, #0x{NUMBER_OF_DAYS:x}'),
                    ('csel', 'w8, w9, w8, lt'), ('bic', 'w0, w8, w8, asr #31')],
         keep={'field', 'const', 'sub', 'cmp', 'csel', 'bic'})

    # --- four states, decided by comparing the last collection's date with today ---
    want('state', [
        ('const', 'w8, #1'),
        ('call', 'get_Date'), ('call', 'get_currentTimeUTC'), ('call', 'get_Date'),
        ('call', 'op_Equality'), ('const', f'w0, #{STATES["COLLECTED_TODAY"]}'),
        ('call', 'get_Date'), ('fmov', 'd0, #1.00000000'), ('call', 'AddDays'),
        ('call', 'get_currentTimeUTC'), ('call', 'get_Date'), ('call', 'op_Equality'),
        ('call', 'get_Date'), ('fmov', 'd0, #1.00000000'), ('call', 'AddDays'),
        ('call', 'get_currentTimeUTC'), ('call', 'get_Date'), ('call', 'op_LessThan'),
        ('const', f'w8, #{STATES["MISSED_COLLECT_RESET"]}'), ('cinc', 'w0, w8, eq')],
        keep={'call', 'const', 'fmov', 'cinc'})

    # --- the bonus itself ---
    want('bonus', [
        ('const', 'w8, #1'),
        ('call', 'GetCollected'), ('cmp', f'w0, #{STATES["COLLECTED_TODAY"]}'),
        ('field', 'currentDayNumber'), ('const', f'w9, #0x{NUMBER_OF_DAYS:x}'),
        ('sub', 'w8, w8, #1'), ('cmp', f'w8, #0x{NUMBER_OF_DAYS:x}'),
        ('csel', 'w8, w8, w9, lt'), ('bic', 'w8, w8, w8, asr #31'), ('scvtf', 'd8, w8'),
        ('const', f'w1, #0x{BONUS_IDS["DamagePerConsecutiveLoginDay"]:x}'),
        ('GetBonus', 'DamagePerConsecutiveLoginDay'), ('fmov', 'd0, d8'), ('call', 'Pow'),
        ('const', f'w1, #0x{BONUS_IDS["AllDamage"]:x}'), ('const', 'w4, #1'),
        ('call', 'ModifyBonus')],
        keep={'call', 'GetBonus', 'field', 'const', 'cmp', 'sub', 'csel', 'bic', 'scvtf', 'fmov'})

    # The exponent starts at zero and is only replaced inside the branch, so a missed day means
    # Pow(bonus, 0) - exactly 1, whatever the bonus is.
    zeroed = [i for i in machine.disasm(body(METHODS['bonus'][0]), METHODS['bonus'][0])
              if i.mnemonic == 'movi' and i.op_str.startswith('d8')]
    if not zeroed:
        raise ValueError('the exponent is no longer zeroed before the streak branch')

    document = {
        'version': '8.2.0',
        'role': '連續登入天數的傷害加成：指數是天數、底數是加成，漏領一天就整項失效。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': 'DailyRewardModel.UpdateBonusPerConsecutiveLoginDay 是 '
                   'DamagePerConsecutiveLoginDay 唯一的取值點，而它不是單純相乘：'
                   '指數先設 0，只有在 GetCollected() ≤ COLLECTED_TODAY 時才換成 LoginStreakCapped，'
                   '然後 AllDamage ×= Pow(該加成, 指數)。'
                   'LoginStreak 是 currentDayNumber − 1，LoginStreakCapped 再夾到 '
                   f'[0, NUMBER_OF_DAYS={NUMBER_OF_DAYS}]。'
                   'GetCollected 比對上次領取的日期與今天：同一天是 COLLECTED_TODAY(1)，'
                   '上次領取加一天等於今天是 CAN_COLLECT_TODAY(0)，'
                   '上次領取加一天早於今天是 MISSED_COLLECT_RESET(2)，其餘是 ERROR(3)。'
                   '**所以漏掉一天，整個加成就變成 Pow(加成, 0) = 1**，不是慢慢遞減。',
        'consequence': '本專案目前只有「第幾天領獎」的循環索引，沒有「連續幾天」與「中斷」的概念，'
                       '所以這個加成一直沒有來源可用。接上之後，'
                       '有對應套裝的玩家每連續登入一天傷害就多乘一次，最多十四次；'
                       '漏領一天就全部歸零，要從頭再累積。',
        'methods': {key: fact(address) for key, (address, _) in METHODS.items()},
        'formulas': {
            'streak': 'currentDayNumber − 1',
            'cappedStreak': f'clamp(currentDayNumber − 1, 0, {NUMBER_OF_DAYS})',
            'state': '同一天→COLLECTED_TODAY；上次＋1 天＝今天→CAN_COLLECT_TODAY；'
                     '上次＋1 天＜今天→MISSED_COLLECT_RESET；其餘→ERROR',
            'damage': 'AllDamage ×= Pow(DamagePerConsecutiveLoginDay, '
                      '狀態 ≤ COLLECTED_TODAY ? 夾住的連續天數 : 0)',
        },
        'traces': traces,
        'states': STATES,
        'numberOfDays': NUMBER_OF_DAYS,
        'bonusIds': BONUS_IDS,
        'limits': [
            '日期比較走的是 UTC 的日界（GHTime.currentTimeUTC 取 .Date），'
            '本專案的 dayAt 是 floor(epoch 毫秒 ÷ 86400000)，基準同樣是 UTC，兩者一致。',
            'ERROR(3) 這個狀態要上次領取的日期在未來才會出現（改過系統時間或存檔被動過）。'
            '它與 MISSED 一樣讓加成失效，所以本專案不分這兩者。',
            'currentDayNumber 怎麼在領取時前進與重置，不在這個方法裡；'
            '本文件只釘住「它減一夾住之後當指數」與「狀態決定要不要用」這兩件事。',
        ],
    }
    out = ROOT/'reference/tt2/8.2.0/login-streak-evidence.json'
    out.write_bytes((json.dumps(document, ensure_ascii=False, indent=2)+'\n').encode('utf-8'))
    print(f'wrote {out.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
