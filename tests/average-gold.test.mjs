import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import {
  fresh, goldReward, average10xGold, averageJackpotGold, JACKPOT_GOLD_EXPO, BONUS_DEFAULTS,
} from '../lib/engine.ts';
import { PENDING_HERO_EFFECTS, heroPassiveTotals } from '../lib/tt2-hero-passives.ts';
import { effect } from '../lib/tt2-rules.ts';
import { TT2_ARTIFACTS, TT2_HEROES } from '../lib/tt2-data.ts';
import { ratio } from '../lib/big-number.ts';

const evidence = JSON.parse(readFileSync(new URL('average-gold-evidence.json', referenceRoot), 'utf8'));
const defaults = JSON.parse(readFileSync(new URL('bonus-defaults-evidence.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));

const CHALICE = TT2_ARTIFACTS.findIndex(a => a.effect === 'JackpotGoldChance'); // 神聖酒杯
const COIN = TT2_ARTIFACTS.findIndex(a => a.effect === 'JackpotGold');          // 札金索斯的金幣

const at = stage => {
  const s = fresh(1000);
  s.stage = stage;
  s.best = stage;
  return s;
};

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
});

test('兩個期望值的形狀與那份 allow-list 都在證據裡', () => {
  assert.equal(evidence.formulas.average10x, '1 + 9 × Bonus(型)，只認三型，其餘 LogError 回 1');
  assert.equal(evidence.formulas.averageJackpot,
    '1 + Bonus(JackpotGoldChance) × (Bonus(JackpotGold)^jackpotGoldBonusExpo − 1)');
  assert.deepEqual(evidence.allowedX10Bonuses,
    ['BossGoldx10Chance', 'ChestGoldx10Chance', 'Goldx10Chance']);
  // 兩個消費端問的第二個 x10 不一樣，這是引擎分兩行寫的理由。
  assert.deepEqual(evidence.consumers.MonsterModel$$GetAverageBossGoldDrop.x10Bonuses,
    ['Goldx10Chance', 'BossGoldx10Chance']);
  assert.deepEqual(evidence.consumers.FairyController$$GetFairyGoldAmount.x10Bonuses,
    ['Goldx10Chance', 'ChestGoldx10Chance']);
});

test('兩個函式就是課本上的期望值', () => {
  // 十分之一機率拿十倍：1 + 9p。
  assert.equal(average10xGold(0), 1);
  assert.equal(average10xGold(1), 10);
  for (const p of [0.01, 0.05, 0.25]) {
    assert.ok(Math.abs(average10xGold(p) - (p*10 + (1-p)*1)) < 1e-12, `p=${p}`);
  }
  // 有 p 的機率拿 M 倍：1 + p(M − 1)。沒機率就完全沒有作用，機率 1 就是整個倍率。
  assert.equal(averageJackpotGold(5, 0), 1);
  assert.equal(averageJackpotGold(5, 1), 5);
  for (const [m, p] of [[5, 0.2], [3, 0.5], [12, 0.03]]) {
    assert.ok(Math.abs(averageJackpotGold(m, p) - (p*m + (1-p)*1)) < 1e-12, `${m}/${p}`);
  }
  assert.equal(JACKPOT_GOLD_EXPO, evidence.coefficients.jackpotGoldBonusExpo.value);
});

test('Goldx10Chance 的編譯期基礎值有接上，而且就是證據上的 0.01', () => {
  assert.equal(BONUS_DEFAULTS.goldx10Chance, Math.fround(defaults.defaults.Goldx10Chance.value));
  assert.equal(defaults.defaults.Goldx10Chance.value, evidence.coefficients.Goldx10Chance.value);
  // 加法型，中性值是 0，所以基礎值一定要加上去，否則整條期望值退化成 1。
  const s = fresh(1000);
  assert.equal(effect(s.tt2, 'Goldx10Chance'), 0, '加成本身沒有來源時是 0');
  // 基礎值是 float32，所以 1.09 只到小數第七位才對得上，不是寫錯。
  assert.ok(Math.abs(average10xGold(BONUS_DEFAULTS.goldx10Chance) - 1.09) < 1e-7);
});

test('乾淨存檔的妖精與寵物都多乘那 1.09，其他三種沒有', () => {
  const s = at(100), tenx = average10xGold(BONUS_DEFAULTS.goldx10Chance);
  // 寵物與頭目之間只差這一項（PetGoldQTEAmount 與 GoldSpecialty 在乾淨存檔都是 1）。
  assert.ok(Math.abs(ratio(goldReward(s, 'pet'), goldReward(s, 'boss')) - tenx) < 1e-9);
  // 寶箱與小怪之間沒有這一項，只有寶箱本來那 15 倍。
  assert.ok(Math.abs(ratio(goldReward(s, 'chest'), goldReward(s, 'monster')) - 15) < 1e-9);
});

test('沒有機率來源時，累積金幣的倍率對妖精完全不生效', () => {
  const s = at(100);
  s.tt2.artifacts[COIN] = 50;
  assert.ok(effect(s.tt2, 'JackpotGold') > 1, '札金索斯的金幣要真的給出倍率');
  assert.equal(effect(s.tt2, 'JackpotGoldChance'), 0);
  const plain = at(100);
  // 妖精走期望值，機率 0 就是 1 倍——神器完全沒有作用，這是原生行為。
  assert.ok(Math.abs(ratio(goldReward(s, 'fairy'), goldReward(plain, 'fairy'))-1) < 1e-9);
  // 小怪那一端還是無條件乘上去，這是登記在 monsterGold 的偏差，不是漏改。
  assert.ok(Math.abs(ratio(goldReward(s, 'monster'), goldReward(plain, 'monster'))
    - effect(s.tt2, 'JackpotGold')) < 1e-9);
});

test('有了機率來源，妖精拿到的就落在 1 與整個倍率之間', () => {
  const s = at(100);
  s.tt2.artifacts[COIN] = 50;
  s.tt2.artifacts[CHALICE] = 50;
  const amount = effect(s.tt2, 'JackpotGold'), chance = effect(s.tt2, 'JackpotGoldChance');
  assert.ok(chance > 0 && chance < 1, `神聖酒杯要給出一個真的機率，拿到 ${chance}`);
  const plain = at(100), gained = ratio(goldReward(s, 'fairy'), goldReward(plain, 'fairy'));
  assert.ok(Math.abs(gained - averageJackpotGold(amount, chance)) < 1e-9);
  assert.ok(gained > 1 && gained < amount, '期望值要夾在「沒中」與「全中」之間');
});

test('英雄被動的十倍金幣不再被擋掉', () => {
  assert.equal(PENDING_HERO_EFFECTS.has('Goldx10Chance'), false);
  // 擋著的只剩這兩個，各自缺自己的消費端。
  assert.deepEqual([...PENDING_HERO_EFFECTS].sort(), ['MultiMonstersGold', 'PetGoldQTEAmount']);
  const levels = Array(37).fill(0);
  levels[TT2_HEROES.findIndex(h => h.id === 'H16')] = 500;
  const totals = heroPassiveTotals(levels);
  assert.ok(totals.Goldx10Chance > 0, 'H16 的三段十倍金幣要累計得到');
  const s = at(100);
  s.heroes[TT2_HEROES.findIndex(h => h.id === 'H16')] = 500;
  assert.ok(ratio(goldReward(s, 'fairy'), goldReward(at(100), 'fairy')) > 1,
    '接上之後那個被動要真的讓妖精多給');
});

test('實際掉落那條擲骰還沒做，形狀先記下來', () => {
  assert.equal(evidence.formulas.rollPath,
    'Try10xGold() 回中了幾次 → × 10^次數；'
    +'RollGoldBonus(JackpotGoldChance) 中了 → × Bonus(JackpotGold)');
  // JackpotGold 在原生只有兩個取值點，期望值與擲骰各一個。
  assert.deepEqual(evidence.jackpotReaders,
    ['BonusModel$$GetAverageJackpotGold', 'StageLogic$$CalculateMonsterGoldDrop']);
});
