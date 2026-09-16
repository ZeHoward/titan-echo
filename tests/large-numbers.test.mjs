import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, apply, fresh, manaMax, manaRegen } from '../lib/engine.ts';
import { validateSnapshot } from '../lib/sheets-cloud.ts';

const CAP = 1e240;

/** Every number a save holds, with the path that reached it. */
function numbers(value, path = 'state', found = []) {
  if (typeof value === 'number') found.push([path, value]);
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) numbers(child, `${path}.${key}`, found);
  }
  return found;
}
const nonFinite = state => numbers(state).filter(([, value]) => !Number.isFinite(value)).map(([path]) => path);

/** A save pushed to the engine ceiling on every axis that scales. */
function maximalSave() {
  const state = fresh(1000);
  state.gold = CAP; state.relics = CAP; state.diamonds = CAP; state.dust = CAP;
  state.best = 1e9; state.stage = 1e9; state.level = 1e9; state.prestiges = 1e6;
  state.heroes = state.heroes.map(() => 1e6);
  state.weapons = state.weapons.map(() => 1000);
  state.artifacts = state.artifacts.map(() => 1e4);
  state.skillLevels = state.skillLevels.map(() => 10);
  state.tt2.artifacts = state.tt2.artifacts.map(() => 1e4);
  state.tt2.spent = state.tt2.spent.map(() => 1e6);
  state.tt2.tree = state.tt2.tree.map(() => 99);
  state.tt2.petLevels = state.tt2.petLevels.map(() => 1000);
  state.tt2.scrolls = state.tt2.scrolls.map(() => 100);
  return state;
}

test('a maxed save never stores Infinity or NaN, even after a long offline gap', () => {
  const state = maximalSave();
  assert.deepEqual(nonFinite(state), []);
  advance(state, state.last + 86400000 * 30);
  assert.deepEqual(nonFinite(state), [], '離線演算後不應出現非有限值');
  advance(state, state.last + 86400000 * 365);
  assert.deepEqual(nonFinite(state), [], '一年離線後不應出現非有限值');
});

test('the mana pool and its regen stay finite at the engine ceiling', () => {
  const state = maximalSave();
  // Unbounded pool or regen used to write Infinity into the save and break validation.
  assert.ok(Number.isFinite(manaMax(state)), 'manaMax');
  assert.ok(Number.isFinite(manaRegen(state)), 'manaRegen');
  assert.ok(manaMax(state) <= CAP);
  advance(state, state.last + 86400000);
  assert.ok(Number.isFinite(state.tt2.mana));
  assert.ok(state.tt2.mana <= manaMax(state));
});

test('every action on a maxed save keeps the numbers finite', () => {
  let state = maximalSave();
  advance(state, state.last + 3600000);
  for (const type of ['tap', 'upgrade', 'skill', 'buyArtifact', 'craft', 'prestige']) {
    for (const index of [0, 1, 5]) {
      try { state = apply(state, { type, index, at: state.last + 1000 }); } catch { /* action may be unavailable */ }
      assert.deepEqual(nonFinite(state), [], `${type}/${index} 後出現非有限值`);
    }
  }
});

test('a maxed save still serialises inside the cloud size limit', () => {
  const state = maximalSave();
  advance(state, state.last + 86400000 * 30);
  const snapshot = { name: '冒險者', state };
  assert.doesNotThrow(() => validateSnapshot(snapshot));
  const size = JSON.stringify(snapshot).length;
  assert.ok(size < 40000, `存檔 ${size} 位元組應小於雲端上限`);
  // The round trip must not turn a ceiling value into a string or lose it.
  const round = JSON.parse(JSON.stringify(snapshot));
  assert.equal(round.state.relics, CAP);
  assert.deepEqual(nonFinite(round.state), []);
  assert.doesNotThrow(() => validateSnapshot(round));
});

test('the ceiling is a clamp, not an overflow: values stop at it instead of becoming Infinity', () => {
  const state = maximalSave();
  advance(state, state.last + 86400000 * 30);
  for (const [path, value] of numbers(state)) {
    assert.ok(value <= CAP || path.endsWith('.last') || path.endsWith('.at') || path.includes('At')
      || path.endsWith('.bossEnd') || path.endsWith('.endAt') || path.endsWith('.rng'),
      `${path} = ${value} 超過封頂`);
  }
});
