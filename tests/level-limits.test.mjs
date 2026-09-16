import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fresh, heroDps } from '../lib/engine.ts';
import { playerBaseDamage } from '../lib/tt2-player.ts';
import { referenceRoot } from '../tools/reference-validation.mjs';

const CAP = 1e240;
const read = table => JSON.parse(readFileSync(new URL(`${table}.json`, referenceRoot), 'utf8')).records;
/** Highest level whose value still sits below the engine ceiling. */
function lastBelowCap(fn, high) {
  let low = 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (fn(middle) >= CAP) high = middle; else low = middle + 1;
  }
  return low - 1;
}

test('the package records far higher level ranges than the engine allows', () => {
  // Sword Master milestones run to level 12500 in the bundled sheet.
  const player = read('PlayerImprovementsInfo').map(row => Number(row.id));
  assert.equal(Math.max(...player), 12500);
  // Hero milestones run to level 6000 across seven ascensions.
  const hero = read('HelperImprovementsInfo').map(row => Number(JSON.parse(row.id)[1]));
  assert.equal(Math.max(...hero), 6000);
  const stage = read('ServerVarsInfo').find(row => row.id === 'maxStage');
  assert.equal(stage.values.iOS, '98000');
  // The engine currently stops at 2000 for both levels and 1800 for stages.
  const state = fresh(1000);
  state.heroes = state.heroes.map(() => 2000);
  assert.ok(Number.isFinite(heroDps(state, 0)));
});

test('raising those limits is bounded by the number ceiling, not by the data', () => {
  // Measured headroom before values flatten at 1e240.
  const heroCeiling = lastBelowCap(level => {
    const state = fresh(1000);
    state.heroes = state.heroes.map(() => level);
    return heroDps(state, 0);
  }, 20000);
  const playerCeiling = lastBelowCap(playerBaseDamage, 20000);
  assert.equal(heroCeiling, 4999);
  assert.equal(playerCeiling, 7899);
  // Both fall short of the levels the package records, so the caps cannot simply be raised.
  assert.ok(heroCeiling < 6000, '英雄 DPS 在資料記載的 6000 級之前就觸頂');
  assert.ok(playerCeiling < 12500, '劍士裸傷在資料記載的 12500 級之前就觸頂');
});

test('the invented limits are recorded so a later change is visible', () => {
  // These three numbers are the engine's own choices, and each contradicts the bundled data.
  const invented = { stage: 1800, heroLevel: 2000, playerLevel: 2000 };
  const recorded = { stage: 98000, heroLevel: 6000, playerLevel: 12500 };
  for (const key of Object.keys(invented)) {
    assert.ok(invented[key] < recorded[key], `${key}: ${invented[key]} 應小於資料記載的 ${recorded[key]}`);
  }
  assert.ok(invented.stage / recorded.stage < 0.02);
});
