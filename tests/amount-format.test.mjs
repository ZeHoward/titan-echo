import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { advance, apply, fresh, hydrate, toAmount } from '../lib/engine.ts';
import { toSheetsWire, validateSnapshot } from '../lib/sheets-cloud.ts';
import { toNumber } from '../lib/big-number.ts';

const script = readFileSync(new URL('../public/google-sheets/Code.gs', import.meta.url), 'utf8');
/** A save as builds before 2.8 wrote it: every amount a plain number. */
function oldSave() {
  const state = fresh(1000);
  return { ...state, gold: 1234.5, hp: 99, tt2: { ...state.tt2, lastHit: 7, lastPetHit: 3 } };
}

test('a save written with plain amounts keeps its values and gains nothing', () => {
  const s = hydrate(oldSave());
  assert.deepEqual(s.gold, { s: 1.2345, e: 3 });
  assert.equal(toNumber(s.gold), 1234.5);
  assert.equal(toNumber(s.hp), 99);
  assert.equal(toNumber(s.tt2.lastHit), 7);
  assert.equal(toNumber(s.tt2.lastPetHit), 3);
  // Nothing else about the save moves: this is a representation change, not a migration.
  const before = oldSave();
  for (const key of ['stage', 'best', 'level', 'relics', 'diamonds', 'prestiges', 'ruleset']) {
    assert.deepEqual(s[key], before[key], key);
  }
  assert.deepEqual(s.heroes, before.heroes);
  assert.equal(s.heroes.length, 33);
  assert.equal(s.artifacts.length, 30);
});

test('hydrating twice changes nothing, so a repeated load cannot drift', () => {
  const once = hydrate(oldSave());
  const twice = hydrate(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice.gold, once.gold);
  assert.deepEqual(twice.hp, once.hp);
  assert.deepEqual(hydrate(twice).gold, once.gold);
});

test('an unusable amount reads as zero rather than reaching the save as NaN', () => {
  for (const broken of [undefined, null, NaN, Infinity, -Infinity, 'x', {}, { s: 1 }]) {
    assert.deepEqual(toAmount(broken), { s: 0, e: 0 }, JSON.stringify(broken) ?? 'undefined');
  }
  // A negative balance is not a thing the economy holds.
  assert.deepEqual(toAmount(-5), { s: 0, e: 0 });
  const s = hydrate({ ...oldSave(), gold: Infinity, hp: NaN });
  assert.deepEqual(s.gold, { s: 0, e: 0 });
  assert.doesNotThrow(() => validateSnapshot({ name: '冒險者', state: s }));
});

test('what goes to Sheets is the shape the deployed script validates', () => {
  // The script checks these keys are finite non-negative numbers, and players run their own
  // deployed copy, so the wire has to keep satisfying the copy they already have.
  const checked = /for \(const k of \[([^\]]+)\]\)/.exec(script);
  assert.ok(checked, 'Code.gs 的欄位檢查格式改變了');
  const keys = checked[1].split(',').map(part => part.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(keys, ['stage', 'best', 'level', 'gold', 'last', 'prestiges']);
  assert.match(script, /typeof st\[k\] !== 'number' \|\| !Number\.isFinite\(st\[k\]\)/);

  const state = fresh(1000);
  state.gold = { s: 4.2, e: 9000 };
  const wire = toSheetsWire(state);
  for (const key of keys) {
    assert.equal(typeof wire[key], 'number', key);
    assert.ok(Number.isFinite(wire[key]) && wire[key] >= 0, key);
  }
  // The number saturates, so the exact magnitude travels beside it.
  assert.equal(wire.gold, Number.MAX_VALUE);
  assert.deepEqual(wire.goldAmount, { s: 4.2, e: 9000 });
});

test('a snapshot that came back from Sheets restores the exact balance', () => {
  const state = fresh(1000);
  state.gold = { s: 4.2, e: 9000 };
  const returned = JSON.parse(JSON.stringify({ name: '冒險者', state: toSheetsWire(state) }));
  // Reads accept the wire shape, then hold the normalised save to the current format.
  validateSnapshot(returned, { slots: 'lenient' });
  assert.throws(() => validateSnapshot(returned), /存檔格式不正確/);
  hydrate(returned.state);
  validateSnapshot(returned);
  assert.deepEqual(returned.state.gold, { s: 4.2, e: 9000 });
  assert.equal(returned.state.goldAmount, undefined, '線上欄位不應留在存檔裡');
});

test('an older deployment that only stores gold still loads, at the value it could hold', () => {
  // Some deployment may drop the extra field; the save then reads back the saturated number,
  // which is a loss of magnitude but never a broken save.
  const wire = toSheetsWire({ ...fresh(1000), gold: { s: 4.2, e: 9000 } });
  delete wire.goldAmount;
  const snapshot = { name: '冒險者', state: JSON.parse(JSON.stringify(wire)) };
  validateSnapshot(snapshot, { slots: 'lenient' });
  hydrate(snapshot.state);
  validateSnapshot(snapshot);
  assert.equal(toNumber(snapshot.state.gold), Number.MAX_VALUE);
});

test('playing on after a load spends and earns against the restored balance', () => {
  const s = hydrate(oldSave());
  const before = toNumber(s.gold);
  apply(s, { type: 'upgrade', amount: 1, at: s.last });
  assert.ok(toNumber(s.gold) < before, '升級應扣款');
  assert.ok(toNumber(s.gold) >= 0);
  advance(s, s.last + 600000);
  assert.ok(Number.isFinite(s.gold.s) && Number.isFinite(s.gold.e));
  assert.doesNotThrow(() => validateSnapshot({ name: '冒險者', state: s }));
});
