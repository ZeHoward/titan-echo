import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apply, fresh, heroDps, cost } from '../lib/engine.ts';
import { playerBaseDamage, playerUpgradeCost } from '../lib/tt2-player.ts';
import { HERO_LEVEL_CAP, PLAYER_LEVEL_CAP, STAGE_CAP } from '../lib/tt2-limits.ts';
import { referenceRoot } from '../tools/reference-validation.mjs';

const read = table => JSON.parse(readFileSync(new URL(`${table}.json`, referenceRoot), 'utf8')).records;
const finite = value => Number.isFinite(value.s) && Number.isFinite(value.e) && value.s >= 1 && value.s < 10;

test('each ceiling is the number the package records, not one the engine chose', () => {
  const player = read('PlayerImprovementsInfo').map(row => Number(row.id));
  assert.equal(PLAYER_LEVEL_CAP, Math.max(...player));
  assert.equal(PLAYER_LEVEL_CAP, 12500);
  const hero = read('HelperImprovementsInfo').map(row => Number(JSON.parse(row.id)[1]));
  assert.equal(HERO_LEVEL_CAP, Math.max(...hero));
  assert.equal(HERO_LEVEL_CAP, 6000);
  const stage = read('ServerVarsInfo').find(row => row.id === 'maxStage');
  assert.equal(STAGE_CAP, Number(stage.values.iOS));
  // The three the engine used to impose, each below what the data records.
  for (const [invented, recorded] of [[1800, STAGE_CAP], [2000, HERO_LEVEL_CAP], [2000, PLAYER_LEVEL_CAP]]) {
    assert.ok(invented < recorded);
  }
});

test('the whole recorded level range is computable, where it used to flatten', () => {
  // Measured before the change: hero damage sat on the ceiling from level 4999, the Sword Master
  // from 7899. Both are inside the range the package records, so both were reachable in play.
  const state = fresh(1000);
  for (const level of [4999, 5000, HERO_LEVEL_CAP]) {
    state.heroes = state.heroes.map(() => level);
    assert.ok(finite(heroDps(state, 0)), `英雄 ${level} 級`);
  }
  state.heroes = state.heroes.map(() => HERO_LEVEL_CAP - 1);
  assert.ok(heroDps(state, 0).e < heroDps({ ...state, heroes: state.heroes.map(() => HERO_LEVEL_CAP) }, 0).e + 1);
  for (const level of [7899, 7900, PLAYER_LEVEL_CAP]) {
    assert.ok(finite(playerBaseDamage(level)), `劍術大師 ${level} 級`);
    assert.ok(finite(playerUpgradeCost(level, 1)), `劍術大師 ${level} 級升級費用`);
  }
  // Every one of these is past the double range, so none of them could have been a plain number.
  assert.ok(playerBaseDamage(PLAYER_LEVEL_CAP).e > 308);
  assert.ok(heroDps({ ...state, heroes: state.heroes.map(() => HERO_LEVEL_CAP) }, 0).e > 240);
});

test('buying levels stops at the recorded cap and never spends past it', () => {
  const s = fresh(1000);
  s.gold = { s: 1, e: 4000 };
  for (let n = 0; n < 60; n++) apply(s, { type: 'hero', index: 0, amount: 1000, at: s.last });
  assert.ok(s.heroes[0] <= HERO_LEVEL_CAP, `英雄等級 ${s.heroes[0]}`);
  assert.equal(s.heroes[0], HERO_LEVEL_CAP);
  for (let n = 0; n < 130; n++) apply(s, { type: 'upgrade', amount: 100, at: s.last });
  assert.ok(s.level <= PLAYER_LEVEL_CAP, `劍術大師等級 ${s.level}`);
  // Gold is spent, not invented: the remaining balance is still a usable magnitude.
  assert.ok(finite(s.gold) || s.gold.s === 0);
  assert.ok(finite(cost(s, 0, 1)));
});
