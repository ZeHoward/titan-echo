import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh, stateEffect, dps, tapDamage, goldReward } from '../lib/engine.ts';
import { TT2_ARTIFACTS, TT2_TREE, bonusDefinitions, canBuyTalent, cap } from '../lib/tt2-rules.ts';
import { HERO_LEVEL_CAP, PLAYER_LEVEL_CAP, STAGE_CAP } from '../lib/tt2-limits.ts';

const CLAMP = 1e240;
/** Every source of a bonus at the highest level the rules allow it to reach. */
function fullyUpgraded() {
  const s = fresh(1000);
  s.tt2.artifacts = s.tt2.artifacts.map((_, i) => TT2_ARTIFACTS[i]?.max || 1e6);
  s.tt2.tree = s.tt2.tree.map((_, i) => TT2_TREE[i].max);
  s.tt2.petLevels = s.tt2.petLevels.map(() => 1000);
  s.tt2.scrolls = s.tt2.scrolls.map(() => 100);
  s.heroes = s.heroes.map(() => HERO_LEVEL_CAP);
  s.tt2.extraHeroes = s.tt2.extraHeroes.map(() => HERO_LEVEL_CAP);
  s.level = PLAYER_LEVEL_CAP; s.stage = STAGE_CAP; s.best = STAGE_CAP;
  return s;
}
const targets = Object.keys(bonusDefinitions);

test('the rules stop upgrades at their own maxima, which is what bounds a multiplier', () => {
  const s = fullyUpgraded();
  // A talent already at max cannot be bought again, whatever points are available.
  s.tt2.points = 1e6;
  for (let i = 0; i < TT2_TREE.length; i++) assert.equal(canBuyTalent(s.tt2, i, s.best), false, TT2_TREE[i].id);
  assert.ok(TT2_TREE.every(k => k.max >= 3 && k.max <= 45));
  assert.equal(TT2_ARTIFACTS.every(a => (a.max || 1e6) <= 1e6), true);
});

test('no bonus multiplier gets near the 1e240 clamp, even fully upgraded', () => {
  const s = fullyUpgraded();
  const values = targets.map(target => [target, stateEffect(s, target)]);
  assert.equal(values.length, 640);
  for (const [target, value] of values) {
    assert.ok(Number.isFinite(value), target);
    assert.ok(value < CLAMP, `${target} = ${value}`);
  }
  // Measured headroom: the largest is the gold multiplier, about 89 orders of magnitude short.
  const [largestTarget, largest] = values.reduce((a, b) => (b[1] > a[1] ? b : a));
  assert.equal(largestTarget, 'GoldAll');
  assert.ok(Math.log10(largest) > 145 && Math.log10(largest) < 155, `GoldAll = ${largest}`);
  assert.ok(240 - Math.log10(largest) > 80, '倍率距離安全網應仍有數十個數量級');
});

test('the clamp is a safety net for an out-of-range save, not a limit on play', () => {
  // A save carrying a level no rule can produce still yields a finite number rather than Infinity.
  const broken = fullyUpgraded();
  broken.tt2.tree = broken.tt2.tree.map(() => 99);
  for (const target of targets) assert.ok(Number.isFinite(stateEffect(broken, target)), target);
  assert.equal(cap(Infinity), CLAMP);
  assert.equal(cap(NaN), CLAMP);
  assert.equal(cap(-5), 0);
  assert.equal(cap(7), 7);
});

test('the magnitudes these multipliers feed are still carried as pairs', () => {
  const s = fullyUpgraded();
  for (const [label, value] of [['每秒傷害', dps(s)], ['點擊傷害', tapDamage(s)], ['金幣', goldReward(s, 'monster')]]) {
    assert.ok(Number.isFinite(value.s) && Number.isFinite(value.e), label);
    assert.ok(value.e > 240, `${label} 指數 ${value.e}`);
  }
});
