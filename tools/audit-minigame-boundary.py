"""Check narrow ARM64 observations; publish evidence facts, not disassembly dumps.

Where does a minigame's outcome come from? The package carries full tables for every minigame —
fish, beasts, dig levels, rarity odds, upgrade costs, reward strings — which reads as though the
whole mode could be rebuilt from it. It cannot: every mode sends its spend to the server and parses
the result out of the response. This records, per minigame, which methods produce the outcome and
which are the client's own arithmetic, so the line between the two is checkable rather than asserted.
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

# Per minigame: the methods that hand back an outcome, and what the client works out by itself.
# Names are matched exactly against the symbol table, so a rename in a later version fails loudly.
MINIGAMES = {
    'FishingDerbyMinigameModel': {
        'label': '釣魚大賽',
        'serverOutcome': ['PullFishFromServer', 'TryParsePulledFish', 'ParseFishDict', 'UpdateFishCollection'],
        'serverSupplied': ['SyncWithServer', 'ParseServerMinigameDict', 'ParseServerFishCollection',
                           'ParseServerUpgradeLevel', 'ParseLuresDict', 'SetLureAmount'],
        'clientSide': ['get_TackleBoxSize', 'get_CollectableLures', 'get_LurePerXSeconds',
                       'get_IsTackleBoxFull', 'get_FishingLevel', 'get_FishingLevelMax',
                       'CanUpgrade', 'Upgrade', 'GetUpgradeBase', 'UpdateUpgradeBonuses',
                       'CanCollect', 'IsCollected', 'GetPercentToNextReward'],
    },
    'HuntingMinigameModel': {
        'label': '狩獵',
        'serverOutcome': ['PullBeasts', 'TryParsePulledBeasts', 'ParseBeastDict', 'UpdateCollection'],
        'serverSupplied': ['SyncWithServer', 'ParseServerMinigameDict', 'ParseServerBeastCollection',
                           'ParseServerUpgradeLevel', 'ParseQuiverCollectDict', 'SyncArrows', 'SyncUpgradePoints'],
        'clientSide': ['get_CollectableArrows', 'get_ArrowPerXSeconds', 'get_QuiverCapacity',
                       'get_IsQuiverFull', 'CanUpgrade', 'Upgrade', 'GetUpgradeBase',
                       'UpdateUpgradeBonuses', 'CanCollect', 'IsCollected', 'GetPercentToNextReward'],
    },
    'DigsiteMinigameModel': {
        'label': '挖掘',
        'serverOutcome': ['RevealTile', 'OnBoardComplete', 'BoardCompleteCoroutine'],
        'serverSupplied': ['ParseDict'],
        'clientSide': ['GetLevelInfo', 'GetNumTrinkets', 'GetNumTrinketsCompleted'],
    },
    'BallDropMinigameModel': {
        'label': '落球',
        'serverOutcome': ['Submit', 'CollectRewards', 'ParseContainerCollectDict'],
        'serverSupplied': ['SyncWithServer', 'ParseServerMinigameDict', 'ParsePegsAndBuckets',
                           'ParseServerUpgradeLevel', 'SyncPrestigeCurrency', 'SyncUpgradePoints'],
        'clientSide': ['GetPegValue', 'GetBucketMult', 'CanUpgrade', 'Upgrade', 'UpdateUpgradeBonuses'],
    },
    'MazeMinigameModel': {
        'label': '迷宮',
        'serverOutcome': ['OpenDoor'],
        'serverSupplied': ['SyncWithServer', 'ParseServerDict', 'ParseMaze'],
        'clientSide': ['GetSection', 'IsLastSection', 'InitFloorInfos'],
    },
    'ClanVaultMinigameModel': {
        'label': '公會保險庫',
        'serverOutcome': ['CollectRewards'],
        'serverSupplied': ['SyncWithServer', 'ParseServerMinigameDict'],
        'clientSide': ['CanCollectRewards', 'CanCollectAnyReward', 'AddLocalRewardProgress'],
    },
}


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
    # A method's body runs to the next exported address, which is enough to pin "this code".
    addresses = sorted({m['Address'] for m in script['ScriptMethod']})
    following = {a: b for a, b in zip(addresses, addresses[1:])}

    def body_sha(start):
        end = following.get(start)
        if end is None or end <= start or end - start > 1 << 16:
            return None
        segment = next((s for s in elf.iter_segments()
                        if s['p_type'] == 'PT_LOAD' and s['p_vaddr'] <= start
                        and end <= s['p_vaddr'] + s['p_filesz']), None)
        if segment is None:
            return None
        offset = start - segment['p_vaddr'] + segment['p_offset']
        return sha(binary[offset:offset + (end - start)])

    symbols = {}
    for method in script['ScriptMethod']:
        symbols.setdefault(method['Name'], method['Address'])

    games = {}
    for model, spec in MINIGAMES.items():
        owned = [name for name in symbols if name.startswith(model + '$$')]
        if not owned:
            raise ValueError(f'{model} has no methods in the symbol table')
        entry = {'label': spec['label'], 'methodCount': len(owned),
                 'serverOutcome': {}, 'serverSupplied': {}, 'clientSide': {}}
        for kind in ('serverOutcome', 'serverSupplied', 'clientSide'):
            for short in spec[kind]:
                full = f'{model}$${short}'
                if full not in symbols:
                    raise ValueError(f'missing native method {full}')
                address = symbols[full]
                entry[kind][short] = {'rva': hex(address), 'bytesSha256': body_sha(address)}
        games[model] = entry

    document = {
        'version': '8.2.0',
        'role': '小遊戲的結果從哪裡來：哪些方法交還結果、哪些是客戶端自己算的。',
        'packageSha256': sha(package),
        'binarySha256': sha(binary),
        'scriptSha256': sha(script_bytes),
        'finding': '六個小遊戲全部把花費送到伺服器，再從回應解析結果；'
                   '安裝包內的魚、野獸、關卡、稀有度機率與獎勵字串是顯示用的資料，不是客戶端的抽選規則。',
        'consequence': '抽到什麼、多大、幾點數、給多少獎勵，安裝包內沒有值，不能自行編造；'
                       '可從包內核實的只有升級費用與加成、消耗品回復速度、收藏門檻這類客戶端算式。',
        'games': games,
        'limits': ['方法存在與其位址是事實，方法內部的伺服器請求內容不在包內',
                   '客戶端算式仍可能被線上參數覆蓋，本表不宣稱其數值與線上一致'],
    }
    target = ROOT/'reference/tt2/8.2.0/minigame-server-evidence.json'
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    served = sum(len(g['serverOutcome']) for g in games.values())
    supplied = sum(len(g['serverSupplied']) for g in games.values())
    client = sum(len(g['clientSide']) for g in games.values())
    print(f'Verified {len(games)} minigames: {served} server-outcome, {supplied} server-supplied, '
          f'{client} client-side methods')


if __name__ == '__main__':
    main()
