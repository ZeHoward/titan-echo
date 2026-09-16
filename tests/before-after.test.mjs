import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, advance, fresh, cost, dps, health, heroDps, manaMax, relicGain, skillPower,
  swordMasterBaseDamage, tapDamage } from '../lib/engine.ts';
import { toNumber } from '../lib/big-number.ts';

// Before/after cases for the three moments R05 asks to pin: an upgrade, a skill firing, a prestige.
// The numbers are this build's own output, not a claim about the original game. Their job is to
// make any change to a formula show up as a concrete difference rather than a silent drift.
const N = value => (typeof value === 'number' ? value : toNumber(value));
const snapshot = s => ({
  swordMaster: N(swordMasterBaseDamage(s)),
  tap: N(tapDamage(s)),
  heroOne: N(heroDps(s, 0)),
  dps: N(dps(s)),
  health: N(health(s)),
  nextHeroCost: N(cost(s, 0, 1)),
  nextLevelCost: N(cost(s, -1, 1)),
  manaMax: manaMax(s),
  relicsOnPrestige: relicGain(s),
});
const ratio = (after, before) => Object.fromEntries(
  Object.entries(after).map(([key, value]) => [key, before[key] ? value / before[key] : value]));

test('a Sword Master level changes damage and the next price, and nothing else', () => {
  const s = fresh(1000);
  s.gold = { s: 1, e: 12 };
  const before = snapshot(s);
  apply(s, { type: 'upgrade', amount: 1, at: s.last });
  assert.equal(s.level, 2);
  const after = snapshot(s), moved = ratio(after, before);
  // Level 1 to 2 doubles the intrinsic damage, because the curve is level times milestone.
  assert.ok(Math.abs(moved.swordMaster - 2) < 1e-12, `裸傷倍率 ${moved.swordMaster}`);
  assert.ok(Math.abs(moved.tap - 2) < 1e-12, `點擊傷害倍率 ${moved.tap}`);
  // The next level costs the growth rate more than the last one.
  assert.ok(Math.abs(moved.nextLevelCost - 1.075) < 1e-3, `下一級費用倍率 ${moved.nextLevelCost}`);
  for (const key of ['heroOne', 'dps', 'health', 'nextHeroCost', 'manaMax', 'relicsOnPrestige']) {
    assert.equal(after[key], before[key], `${key} 不應被劍術大師升級影響`);
  }
});

test('a hero level changes that hero and the total, and leaves the player alone', () => {
  const s = fresh(1000);
  s.gold = { s: 1, e: 12 };
  const before = snapshot(s);
  apply(s, { type: 'hero', index: 0, amount: 1, at: s.last });
  assert.equal(s.heroes[0], 1);
  const after = snapshot(s);
  assert.ok(after.heroOne > before.heroOne);
  assert.ok(after.dps > before.dps);
  assert.equal(after.dps, after.heroOne, '只有一位英雄上陣時總傷等於該英雄');
  assert.equal(after.swordMaster, before.swordMaster);
  assert.equal(after.health, before.health);
  // Ten at once is the same geometric sum as ten single purchases, except that each single
  // purchase rounds up on its own. So bulk is never dearer, and only by the rounding.
  const single = fresh(1000); single.gold = { s: 1, e: 12 };
  let total = 0;
  for (let n = 0; n < 10; n++) { total += N(cost(single, 0, 1)); apply(single, { type: 'hero', index: 0, amount: 1, at: single.last }); }
  const bulk = fresh(1000); bulk.gold = { s: 1, e: 12 };
  const ten = N(cost(bulk, 0, 10));
  assert.ok(ten <= total, `十連 ${ten} 不應貴於逐次累計 ${total}`);
  assert.ok(total - ten <= 10, `差額 ${total - ten} 應在每筆進位一元的範圍內`);
  assert.equal(total - ten, 5);
});

test('a skill changes damage only while it is running', () => {
  const s = fresh(1000);
  s.level = 300; s.skillLevels[3] = 1; s.heroes[0] = 10;
  const before = snapshot(s);
  apply(s, { type: 'skill', index: 3, at: s.last });
  assert.ok(s.active[3] > s.last, '技能應處於作用中');
  const during = snapshot(s);
  assert.ok(during.tap > before.tap, '火焰之劍作用中應提高點擊傷害');
  assert.ok(Math.abs(during.tap / before.tap - skillPower(s, 3)) < 1e-9);
  assert.equal(during.heroOne, before.heroOne, '英雄每秒傷害不受此技能影響');
  // Once it expires the value returns to exactly what it was.
  advance(s, s.active[3] + 1000);
  const after = snapshot(s);
  assert.equal(after.tap, before.tap);
  assert.equal(after.swordMaster, before.swordMaster);
});

test('a prestige resets the run and keeps the collection', () => {
  const s = fresh(1000);
  s.best = 200; s.stage = 200; s.worldBest = [200, 200];
  s.level = 50; s.heroes[0] = 30; s.gold = { s: 1, e: 30 };
  s.diamonds = 40; s.tt2.petLevels[0] = 5; s.tt2.points = 3;
  const before = snapshot(s), gain = relicGain(s), relics = s.relics;
  const after = apply(s, { type: 'prestige', at: s.last });
  assert.equal(after.stage, 1);
  assert.equal(after.level, 1);
  assert.equal(after.heroes[0], 0);
  assert.equal(toNumber(after.gold), 0);
  assert.equal(after.relics, relics + gain);
  assert.equal(after.best, 200, '最高關卡保留');
  assert.equal(after.diamonds, 40, '鑽石保留');
  assert.equal(after.tt2.petLevels[0], 5, '寵物等級保留');
  const reset = snapshot(after);
  assert.ok(reset.dps < before.dps);
  assert.ok(reset.health < before.health);
  assert.equal(reset.swordMaster, 1, '等級一的裸傷為 1');
  // A second prestige straight away earns from the stage it is on, not the one it came from,
  // but the formula has a floor of one relic once the system is unlocked.
  assert.equal(relicGain(after), 1);
  assert.ok(relicGain(after) < gain, `重置後 ${relicGain(after)} 應遠低於原本的 ${gain}`);
});
