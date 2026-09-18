import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import {
  fresh, advance, apply, health, isBoss, monsterCount,
  multiMonsterChance, multiMonsterMaxCount, multiMonsterGold,
  BONUS_DEFAULTS, MULTI_MONSTER_MIN,
} from '../lib/engine.ts';
import { effect } from '../lib/tt2-rules.ts';
import { toNumber } from '../lib/big-number.ts';

const evidence = JSON.parse(readFileSync(new URL('multi-monster-evidence.json', referenceRoot), 'utf8'));
const defaults = JSON.parse(readFileSync(new URL('bonus-defaults-evidence.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));

// Indices of the four sources that feed this system, found by the bonus they declare so a
// reshuffled catalog fails here rather than quietly testing nothing.
const AMBUSH = 50;        // MultiMonstersMaxCount + MultiMonstersGold
const LOVE_POTION = 60;   // MultiMonsters
const KITSUNE = 86;       // MultiMonsters
const RABBIT_FOOT = 90;   // AllProbabilityBoost

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
  assert.equal(evidence.binarySha256, defaults.binarySha256, '兩份證據要出自同一個 binary');
});

test('三段算式與原生自己的平均估計都在證據裡', () => {
  assert.equal(evidence.formulas.spawnRoll, 'Random.value < MultiMonsters × AllProbabilityBoost');
  assert.equal(evidence.formulas.groupSize,
    '(int)Random.Range(minMultiMonsterSpawns, MultiMonstersMaxCount + 1)');
  assert.equal(evidence.formulas.groupGold, '單隻金幣 × (1 + (隻數 − 1) × MultiMonstersGold)');
  // Each trace must actually name the bonuses it claims, or the shape check above proved nothing.
  const named = kind => evidence.traces[kind].filter(e => e[0] === 'GetBonus').map(e => e[1]);
  assert.deepEqual(named('spawnRoll'), ['MultiMonsters', 'AllProbabilityBoost']);
  assert.deepEqual(named('groupSize'), ['MultiMonstersMaxCount']);
  assert.deepEqual(named('groupGold'), ['MultiMonstersGold']);
});

test('引擎用的基礎值就是證據上的值', () => {
  assert.equal(BONUS_DEFAULTS.multiMonsterChance, Math.fround(evidence.bases.MultiMonsters.value));
  assert.equal(BONUS_DEFAULTS.multiMonsterMaxCount, evidence.bases.MultiMonstersMaxCount.value);
  assert.equal(MULTI_MONSTER_MIN, evidence.minMultiMonsterSpawns.value);
  assert.equal(evidence.bases.MultiMonsters.field, 'multiMonsterBaseChance');
  assert.equal(evidence.bases.MultiMonstersMaxCount.field, 'maxMultiMonsterSpawns');
  // MultiMonstersGold's base is 1.0 and the bonus is multiplicative, so the engine must not add it
  // on top of its own neutral value - that would double the payout of every group.
  assert.equal(evidence.bases.MultiMonstersGold.value, 1);
  assert.equal(effect(fresh(1000).tt2, 'MultiMonstersGold'), 1);
  assert.equal(multiMonsterGold(fresh(1000), 3), 3, '乾淨存檔三隻就是三份金幣，不是六份');
});

test('乾淨存檔是 1% 機率生出 2–4 隻', () => {
  const s = fresh(1000);
  assert.equal(multiMonsterChance(s), Math.fround(0.01));
  assert.equal(multiMonsterMaxCount(s), 4);
  assert.equal(multiMonsterGold(s, 1), 1, '一隻的一波永遠是 1 倍');
  assert.equal(multiMonsterGold(s, 2), 2);
});

test('三個加成各自推動它該推動的那一項，別的不動', () => {
  const base = fresh(1000);
  const chanceBefore = multiMonsterChance(base);
  const maxBefore = multiMonsterMaxCount(base);
  const goldBefore = multiMonsterGold(base, 3);

  // MultiMonsters moves the roll only.
  const rolled = fresh(1000);
  rolled.tt2.tree[LOVE_POTION] = 9;
  assert.ok(multiMonsterChance(rolled) > chanceBefore, '愛情靈藥要拉高機率');
  assert.equal(multiMonsterMaxCount(rolled), maxBefore, '它不該動到上限');
  assert.equal(multiMonsterGold(rolled, 3), goldBefore, '它不該動到金幣');

  // MultiMonstersMaxCount moves the group size only. One level of Ambush is +2.
  const wider = fresh(1000);
  wider.tt2.tree[AMBUSH] = 1;
  assert.equal(multiMonsterMaxCount(wider), maxBefore + 2, '伏擊一級就是上限 +2');
  assert.equal(multiMonsterChance(wider), chanceBefore, '它不該動到機率');
  assert.ok(multiMonsterGold(wider, 3) > goldBefore, '伏擊同時帶 MultiMonstersGold');

  // AllProbabilityBoost multiplies the roll, and nothing else here.
  const lucky = fresh(1000);
  lucky.tt2.artifacts[RABBIT_FOOT] = 40;
  const boost = effect(lucky.tt2, 'AllProbabilityBoost');
  assert.ok(boost > 1, '兔子腳要給大於 1 的倍率');
  assert.equal(multiMonsterChance(lucky), Math.fround(0.01) * boost);
  assert.equal(multiMonsterMaxCount(lucky), maxBefore);

  // The artifact route into the roll, so it is not only talents that are wired up.
  const fox = fresh(1000);
  fox.tt2.artifacts[KITSUNE] = 40;
  assert.ok(multiMonsterChance(fox) > chanceBefore, '神狐精華要拉高機率');
});

test('機率夾在 1，上限不會低於下限', () => {
  const s = fresh(1000);
  s.tt2.tree[LOVE_POTION] = 9;
  s.tt2.artifacts[KITSUNE] = 40;
  s.tt2.artifacts[RABBIT_FOOT] = 40;
  assert.ok(multiMonsterChance(s) <= 1);
  assert.ok(multiMonsterMaxCount(s) >= MULTI_MONSTER_MIN);
});

test('整波金幣的倍率就是 1 + (隻數 − 1) × MultiMonstersGold', () => {
  const s = fresh(1000);
  s.tt2.tree[AMBUSH] = 3;
  const bonus = effect(s.tt2, 'MultiMonstersGold');
  for (const count of [1, 2, 3, 7, 20]) {
    assert.equal(multiMonsterGold(s, count), count < 2 ? 1 : 1 + (count - 1) * bonus, `${count} 隻`);
  }
});

test('血條帶著整波的隻數，頭目永遠是一隻', () => {
  const s = fresh(1000);
  const single = toNumber(health(s));
  s.tt2.multi = 3;
  assert.ok(Math.abs(toNumber(health(s)) / single - 3) < 1e-9, '三隻的一波就是三倍血量');

  // A boss never spawns as a group, whatever the field happens to hold.
  const boss = fresh(1000);
  boss.kills = monsterCount(boss);
  assert.ok(isBoss(boss));
  const bossHp = toNumber(health(boss));
  boss.tt2.multi = 4;
  assert.equal(toNumber(health(boss)), bossHp, '頭目血量不受隻數影響');
});

test('實際遊玩時每一波都落在 1 與上限之間，而且真的會出現一群', () => {
  const s = fresh(1000);
  // Enough of the roll to make groups common without reaching certainty, so both branches run.
  s.tt2.tree[LOVE_POTION] = 9;
  s.tt2.tree[AMBUSH] = 1;
  s.tt2.artifacts[KITSUNE] = 40;
  s.heroes = s.heroes.map(() => 400);
  const limit = multiMonsterMaxCount(s);
  const seen = new Set();
  let now = s.last;
  for (let n = 0; n < 4000; n++) {
    now += 120;
    apply(s, { type: 'tap', at: now });
    const group = s.tt2.multi;
    assert.ok(Number.isInteger(group) && group >= 1 && group <= limit, `隻數 ${group} 超出 1..${limit}`);
    seen.add(group);
  }
  assert.ok(seen.has(1), '沒中骰的一波應該是一隻');
  assert.ok([...seen].some(n => n >= MULTI_MONSTER_MIN), '中骰的一波應該不只一隻');
  assert.ok([...seen].every(n => n === 1 || n >= MULTI_MONSTER_MIN), '中骰後不會生出比下限少的隻數');
});

test('沒有投資的存檔，一波幾乎都是一隻', () => {
  const s = fresh(1000);
  s.heroes = s.heroes.map(() => 400);
  let now = s.last, groups = 0, waves = 0;
  for (let n = 0; n < 3000; n++) {
    now += 120;
    apply(s, { type: 'tap', at: now });
    waves++;
    if (s.tt2.multi > 1) groups++;
  }
  // The base roll is 1%; this only has to show it is rare, not pin the sample.
  assert.ok(groups / waves < 0.08, `未投資時多重生成不該常見，實測 ${groups}/${waves}`);
});

test('2.16.0 之前的存檔沒有這個欄位，補成一隻而不是零隻', () => {
  const s = fresh(1000);
  delete s.tt2.multi;
  advance(s, s.last + 1);
  assert.equal(s.tt2.multi, 1);

  const broken = fresh(1000);
  broken.tt2.multi = 0;
  advance(broken, broken.last + 1);
  assert.equal(broken.tt2.multi, 1, '零隻會讓血量歸零，一定要補回一隻');
});
