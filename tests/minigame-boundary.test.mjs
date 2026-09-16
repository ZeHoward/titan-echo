import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';

const load = name => JSON.parse(readFileSync(new URL(name + '.json', referenceRoot), 'utf8'));
const evidence = load('minigame-server-evidence');
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
  assert.match(evidence.binarySha256, /^[0-9a-f]{64}$/);
  assert.match(evidence.scriptSha256, /^[0-9a-f]{64}$/);
});

test('六個小遊戲每一個的結果都由伺服器交還', () => {
  const games = Object.entries(evidence.games);
  assert.equal(games.length, 6);
  for (const [model, game] of games) {
    assert.ok(Object.keys(game.serverOutcome).length > 0, `${model} 沒有記錄交還結果的方法`);
    assert.ok(game.methodCount > 0, `${model} 沒有方法`);
    for (const kind of ['serverOutcome', 'serverSupplied', 'clientSide']) {
      for (const [name, fact] of Object.entries(game[kind])) {
        assert.match(fact.rva, /^0x[0-9a-f]+$/, `${model}.${name} 沒有位址`);
      }
    }
  }
});

test('逐一釘住每個小遊戲是「哪一個方法」交還結果', () => {
  const outcome = model => Object.keys(evidence.games[model].serverOutcome);
  // The fish, its size and the XP all arrive in one response; the rarity table in the package is
  // what the rate panel shows, not the roll.
  assert.ok(outcome('FishingDerbyMinigameModel').includes('PullFishFromServer'));
  assert.ok(outcome('FishingDerbyMinigameModel').includes('TryParsePulledFish'));
  assert.ok(outcome('HuntingMinigameModel').includes('PullBeasts'));
  assert.ok(outcome('HuntingMinigameModel').includes('TryParsePulledBeasts'));
  // Even uncovering one tile is a round trip, so the board is not the client's to generate.
  assert.ok(outcome('DigsiteMinigameModel').includes('RevealTile'));
  assert.ok(outcome('BallDropMinigameModel').includes('Submit'));
  assert.ok(outcome('MazeMinigameModel').includes('OpenDoor'));
  assert.ok(outcome('ClanVaultMinigameModel').includes('CollectRewards'));
});

test('連落球的釘子與迷宮的地圖都是伺服器給的，不是客戶端產生的', () => {
  assert.ok(Object.keys(evidence.games.BallDropMinigameModel.serverSupplied).includes('ParsePegsAndBuckets'));
  assert.ok(Object.keys(evidence.games.MazeMinigameModel.serverSupplied).includes('ParseMaze'));
  // GetPegValue only reads what that parse stored, so it is not a formula the package pins down.
  assert.ok(Object.keys(evidence.games.BallDropMinigameModel.clientSide).includes('GetPegValue'));
});

test('客戶端自己算的部分有被分開記錄，沒有整組當成不可知', () => {
  const client = Object.values(evidence.games).reduce((n, g) => n + Object.keys(g.clientSide).length, 0);
  assert.ok(client >= 30, `只記錄了 ${client} 個客戶端方法`);
  // Lure and arrow regeneration, the tacklebox and quiver sizes, the upgrade costs and the
  // collection thresholds are all the client's own arithmetic and can be rebuilt from the package.
  assert.ok(Object.keys(evidence.games.FishingDerbyMinigameModel.clientSide).includes('get_TackleBoxSize'));
  assert.ok(Object.keys(evidence.games.FishingDerbyMinigameModel.clientSide).includes('GetUpgradeBase'));
  assert.ok(Object.keys(evidence.games.HuntingMinigameModel.clientSide).includes('get_QuiverCapacity'));
});

test('引擎沒有偷偷長出自訂的小遊戲抽選', () => {
  // The guard the evidence exists for: no minigame roll may enter lib/ while the outcome is only
  // knowable from a server response. Implementing one later means changing this test on purpose.
  const modules = readdirSync(new URL('../lib/', import.meta.url));
  for (const file of modules) {
    assert.ok(!/minigame|fishing|hunting|digsite|balldrop|maze/i.test(file), `lib/${file} 看起來是小遊戲實作`);
  }
  const engine = readFileSync(new URL('../lib/engine.ts', import.meta.url), 'utf8');
  for (const word of ['FishingDerby', 'HuntingMinigame', 'Digsite', 'BallDrop', 'MazeMinigame']) {
    assert.ok(!engine.includes(word), `lib/engine.ts 出現 ${word}`);
  }
});
