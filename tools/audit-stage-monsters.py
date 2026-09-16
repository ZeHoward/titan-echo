"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

Which titan a stage shows is decided on the client, and this records the chain that decides it:
the cycle band a stage falls in, the background level that band picks, how many of that level's ten
monsters are loaded, and that a normal spawn is a uniform draw among them while the boss is the
level's own. Each fact is tied to a method address and the hash of its body.
"""
import hashlib
import io
import json
import pathlib
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCAL = ROOT/'work/apk-analysis'
sys.path.insert(0, str(LOCAL/'python-libs'))
from elftools.elf.elffile import ELFFile

# Method -> what reading its body established. The rule text is the claim; the hash pins the code
# the claim was read from, so a later package that changes the method fails this audit loudly.
RULES = {
    'BackgroundModel$$GetCycleIndex':
        'BinarySearch 帶 rows 的 level 鍵，結果取 r^(r>>31) 還原插入點後減一（大於 0 才減），'
        '因此關卡剛好等於鍵值時仍屬前一段：關卡 25 是第一段的最後一關。',
    'BackgroundModel$$GetBackgroundIndex':
        '以該段的 level 鍵為起點：index = (關卡 − 鍵 − (段索引>0 ? 1 : 0)) mod ThemeEnd，負數夾為 0。'
        '每一段都從關卡列 1 重新走，走滿 ThemeEnd 列。',
    'BackgroundModel$$GetMonsterIndex':
        '未鎖定背景時直接回 GetBackgroundIndex；鎖定時改為 (關卡−1) mod 5 加上鎖定起點。',
    'BackgroundModel$$GetLevelInfo':
        'characterToStageDict[characterType][level] 直接取用，沒有取模，取模在 GetBackgroundIndex 完成。',
    'BackgroundModel$$GetMonsterListByLevel':
        '取 GetMonsterIndex 的結果當索引，回傳該關卡列的怪物清單。',
    'MonsterController$$GetMonsterDiversity':
        '回傳 GetBackgroundCycleInfoByLevel 的 MonsterDiversity，即該段載入幾隻。',
    'MonsterController$$LoadMonsterByStageLevel':
        '依序呼叫 GetBackgroundThemeByLevel、GetMonsterListByLevel、GetMonsterDiversity 與 GetCycleIndex，'
        '把該關卡列的前 MonsterDiversity 隻載入。',
    'MonsterController$$SpawnMonster':
        '一般生成：清單長度小於 1 時記錯誤，否則 Random.Range(0, count) 取索引再 List.get_Item，'
        '也就是在載入清單中均勻隨機挑一隻。',
}
# The public SpawnMonster(int stageLevel, MonsterClass) overload, not the private sprite one.
SPAWN_PUBLIC = 0x231e2d8


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
    elf = ELFFile(io.BytesIO(binary))
    addresses = sorted({m['Address'] for m in script['ScriptMethod']})
    following = {a: b for a, b in zip(addresses, addresses[1:])}
    by_name = {}
    for method in script['ScriptMethod']:
        by_name.setdefault(method['Name'], []).append(method['Address'])

    def body_sha(start):
        end = following.get(start)
        if end is None or end <= start:
            raise ValueError(f'no extent for 0x{start:x}')
        segment = next(s for s in elf.iter_segments()
                       if s['p_type'] == 'PT_LOAD' and s['p_vaddr'] <= start
                       and end <= s['p_vaddr'] + s['p_filesz'])
        offset = start - segment['p_vaddr'] + segment['p_offset']
        return sha(binary[offset:offset + (end - start)]), end - start

    methods = {}
    for name, rule in RULES.items():
        if name not in by_name:
            raise ValueError(f'missing native method {name}')
        candidates = by_name[name]
        address = SPAWN_PUBLIC if name == 'MonsterController$$SpawnMonster' else candidates[0]
        if address not in candidates:
            raise ValueError(f'{name} no longer has an overload at 0x{address:x}')
        digest, size = body_sha(address)
        methods[name] = {'rva': hex(address), 'bytes': size, 'bytesSha256': digest, 'rule': rule}

    document = {
        'version': '8.2.0',
        'role': '關卡怪物與頭目的選取規則：哪一段、哪一關卡列、載入幾隻、怎麼挑。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'tables': {
            'BackgroundInfo': '70 個關卡列，各有 Theme、Boss 與 Monster1–10。',
            'BackgroundCycleInfo': '48 段，各有起始關卡、ThemeEnd、MonsterDiversity 與 Scale。',
        },
        'methods': methods,
        'limits': [
            '方法位址與位元組雜湊是事實，規則敘述是對該段組合語言的判讀',
            '均勻隨機來自 UnityEngine.Random，本專案改用存檔內的 rng 以維持可重現',
            '怪物識別字是素材名稱，安裝包的在地化檔沒有任何對應的顯示名稱',
        ],
    }
    target = ROOT/'reference/tt2/8.2.0/stage-monster-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(f'Verified {len(methods)} native methods for the stage monster rule')


if __name__ == '__main__':
    main()
