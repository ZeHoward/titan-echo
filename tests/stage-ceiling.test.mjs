import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apply, fresh, health, reward } from '../lib/engine.ts';
import { referenceRoot } from '../tools/reference-validation.mjs';

const CAP = 1e240;
const at = (stage, fn) => {
  const state = fresh(1000);
  state.stage = stage; state.best = stage; state.worldBest = [stage, stage];
  return fn(state);
};
/** Lowest stage at which the value already sits on the engine ceiling. */
function firstCapped(fn) {
  let low = 1, high = 20000;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (at(middle, fn) >= CAP) high = middle; else low = middle + 1;
  }
  return low;
}

test('the stage counter stops at 1800, which is the limit players actually meet', () => {
  const state = fresh(1000);
  state.stage = 1800; state.best = 1800; state.kills = 999; state.farming = false;
  // Clearing a boss at the cap must not move the stage past it.
  const after = apply({ ...state, hp: 0 }, { type: 'tap', at: state.last + 1000 });
  assert.ok(after.stage <= 1800);
  assert.equal(at(1800, health) < CAP, true, '1800 關的血量仍在封頂之下');
});

test('monster health and gold flatten only just past the reachable stage cap', () => {
  // Measured headroom: the numbers survive to 1982 and 2307, the stage counter stops at 1800.
  assert.equal(firstCapped(health), 1982);
  assert.equal(firstCapped(reward), 2307);
  const headroom = 240 - Math.log10(at(1800, health));
  assert.ok(headroom > 21 && headroom < 23, `1800 關距封頂 ${headroom} 個數量級`);
});

test('the reachable cap is two percent of the stage limit the package records', () => {
  const rows = JSON.parse(readFileSync(new URL('ServerVarsInfo.json', referenceRoot), 'utf8')).records;
  const maxStage = rows.find(row => row.id === 'maxStage');
  assert.equal(maxStage.values.iOS, '98000');
  // Removing the 1800 cap without a larger number representation would only buy ~180 stages,
  // because health reaches the engine ceiling at 1982. The two limits have to move together.
  assert.ok(1800 / 98000 < 0.02);
  assert.ok(firstCapped(health) - 1800 < 200);
});
