import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { advance, apply, fmt, fresh, health, manaMax, manaRegen, reward } from '../lib/engine.ts';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { toSheetsWire, validateSnapshot } from '../lib/sheets-cloud.ts';
import { fromNumber, toNumber } from '../lib/big-number.ts';
import { STAGE_CAP, HERO_LEVEL_CAP, PLAYER_LEVEL_CAP } from '../lib/tt2-limits.ts';

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
  // Gold is set past the double range on purpose: at the last stage the reward itself is
  // about 10^10173, so a save that has played there cannot hold its balance in a number.
  state.gold = { s: 1, e: 5000 }; state.relics = CAP; state.diamonds = CAP; state.dust = CAP;
  state.best = STAGE_CAP; state.stage = STAGE_CAP; state.level = PLAYER_LEVEL_CAP; state.prestiges = 1e6;
  state.heroes = state.heroes.map(() => HERO_LEVEL_CAP);
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
  // The round trip must not turn a magnitude into a string or lose it.
  const round = JSON.parse(JSON.stringify(snapshot));
  assert.equal(round.state.relics, CAP);
  assert.deepEqual(round.state.gold, state.gold);
  assert.equal(round.state.gold.e, 5000, '超出 double 範圍的金幣必須完整往返');
  assert.deepEqual(nonFinite(round.state), []);
  assert.doesNotThrow(() => validateSnapshot(round));
  // What the Sheets script receives is this same save with gold as the number it validates.
  const wire = { name: snapshot.name, state: toSheetsWire(state) };
  assert.equal(typeof wire.state.gold, 'number');
  assert.ok(Number.isFinite(wire.state.gold) && wire.state.gold >= 0);
  assert.ok(JSON.stringify(wire).length < 40000);
});

test('magnitudes past the ceiling are carried, not clamped to it', () => {
  const state = maximalSave();
  advance(state, state.last + 86400000 * 30);
  // Every stored magnitude is a significand in [1,10) and a separate exponent, so a value
  // larger than a double can hold is still exact rather than pinned to the old 1e240.
  for (const amount of [state.gold, state.hp, state.tt2.lastHit, state.tt2.lastPetHit]) {
    assert.ok(Number.isFinite(amount.s) && Number.isFinite(amount.e));
    assert.ok(amount.s === 0 || (Math.abs(amount.s) >= 1 && Math.abs(amount.s) < 10), String(amount.s));
  }
  // Thirty days of offline gold at the last stage is itself past the double range, and the
  // save holds the exact figure rather than the old ceiling.
  assert.equal(state.gold.e, 5000);
  assert.equal(toNumber(state.gold), Number.MAX_VALUE);
  assert.ok(health(state).e > 240, `第 ${state.stage} 關血量指數 ${health(state).e}`);
  assert.ok(reward(state).e > 240, `第 ${state.stage} 關金幣指數 ${reward(state).e}`);
});

test('the display never shows NaN, and keeps its Chinese units in order', () => {
  assert.equal(fmt(0), '0');
  assert.equal(fmt(9999), '9,999');
  assert.equal(fmt(10000), '1.0萬');
  assert.equal(fmt(1e8), '1.0億');
  assert.equal(fmt(1e12), '1.0兆');
  assert.equal(fmt(1e44), '1.0載');
  // Past the last unit it falls back to scientific notation rather than inventing a name.
  assert.equal(fmt(1e48), '1.0×10^48');
  assert.equal(fmt(CAP), '1.0×10^240');
  // A magnitude no double can hold still prints its own exponent.
  assert.equal(fmt({ s: 2.4, e: 11817 }), '2.4×10^11817');
  assert.equal(fmt({ s: 0, e: 0 }), '0');
  // Non-finite input is impossible in a valid save, but must still not print NaN.
  for (const value of [NaN, -Infinity]) assert.equal(fmt(value), '0');
  assert.equal(fmt(Infinity), fmt(Number.MAX_VALUE));
  for (const value of [NaN, Infinity, -Infinity]) assert.ok(!/NaN|Infinity/.test(fmt(value)), String(value));
});

test('the engine ceiling is a web-engine choice, and the native type has no matching cap', () => {
  const native = JSON.parse(readFileSync(new URL('native-number-type.json', referenceRoot), 'utf8'));
  assert.equal(native.type, 'GHDouble');
  // Significand and exponent are stored separately, so the original has no 1e240-style ceiling.
  assert.deepEqual(native.representation.parts, ['exponent', 'significand']);
  assert.ok(native.constants.includes('MaxValue'));
  assert.ok(native.constants.includes('PositiveInfinity') && native.constants.includes('NaN'));
  // The gold ceiling exists as a server var but the package carries no value for it.
  assert.equal(native.boundedByServerVar.maxGold, null);
  assert.equal(native.boundedByServerVar.maxStage.values.iOS, '98000');
  assert.equal(native.boundedByServerVar.relicsStageMax.values.Value, '180000');
  assert.match(native.evidenceScope, /live values and formulas unverified/);
});
