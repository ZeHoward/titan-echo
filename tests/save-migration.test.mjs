import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh, hydrate } from '../lib/engine.ts';
import { TT2_RULESET } from '../lib/tt2-rules.ts';
import { SAVE_ARRAY_KEYS, saveIdOrder } from '../lib/tt2-save-ids.ts';
import { validateSnapshot } from '../lib/sheets-cloud.ts';

/** A save as version 2.6 wrote it: no ruleset, no tt2 block, no artifactSpent column. */
function legacySave() {
  const state = { ...structuredClone(fresh(1000)) };
  delete state.ruleset;
  delete state.tt2;
  delete state.artifactSpent;
  state.artifacts = Array(30).fill(0);
  state.artifacts[0] = 5; state.artifacts[1] = 4; state.artifacts[2] = 3;
  state.heroes = Array(33).fill(0).map((_, i) => i);
  state.skillLevels = [4, 3, 2, 1, 1, 1];
  state.relics = 100; state.best = 900; state.kills = 42;
  return state;
}

test('an old 2.6 save migrates once, refunding its artifact spend into relics', () => {
  const state = legacySave();
  hydrate(state);
  assert.equal(state.ruleset, TT2_RULESET);
  assert.ok(state.tt2);
  // Spend is derived as level squared for the first three artifacts: 25 + 16 + 9.
  assert.equal(state.relics, 150);
  assert.deepEqual(state.tt2.legacyArtifacts.slice(0, 3), [5, 4, 3]);
  assert.deepEqual(state.tt2.legacySpent.slice(0, 3), [25, 16, 9]);
  // The old artifact investment is cleared once it has been refunded.
  assert.deepEqual(state.artifacts, Array(30).fill(0));
  assert.deepEqual(state.artifactSpent, Array(30).fill(0));
  assert.ok(state.log[0].includes('舊神器投入退回聖物'));
  const order = saveIdOrder(TT2_RULESET);
  for (const key of SAVE_ARRAY_KEYS) assert.equal(state[key].length, order[key].length, key);
  assert.doesNotThrow(() => validateSnapshot({ name: '冒險者', state }));
});

test('running the migration again does not refund a second time', () => {
  const state = legacySave();
  hydrate(state);
  const after = structuredClone(state);
  hydrate(state);
  assert.equal(state.relics, after.relics);
  assert.deepEqual(state.tt2.legacyArtifacts, after.tt2.legacyArtifacts);
  assert.deepEqual(state.tt2.legacySpent, after.tt2.legacySpent);
  assert.equal(state.log.length, after.log.length);
  hydrate(state);
  assert.equal(state.relics, 150);
});

test('a save whose tt2 block went missing is repaired, not migrated again', () => {
  const state = fresh(1000);
  state.skillLevels = [3, 2, 1, 0, 0, 0];
  state.kills = 77; state.world = 1; state.relics = 500; state.best = 900;
  state.artifacts[0] = 6; state.artifactSpent[0] = 36;
  const damaged = structuredClone(state);
  delete damaged.tt2;
  hydrate(damaged);
  assert.ok(damaged.tt2, 'tt2 應重建');
  // The legacy path would refund artifactSpent again and clear these; repairing must not.
  assert.equal(damaged.relics, 500);
  assert.deepEqual(damaged.skillLevels, [3, 2, 1, 0, 0, 0]);
  assert.equal(damaged.kills, 77);
  assert.equal(damaged.world, 1);
  assert.deepEqual(damaged.artifacts, state.artifacts);
  assert.deepEqual(damaged.artifactSpent, state.artifactSpent);
  assert.deepEqual(damaged.log, state.log, '不應留下誤導的切換規則訊息');
});

test('a partially written tt2 block keeps the fields it already has', () => {
  const state = fresh(1000);
  state.tt2.eventCurrency = 12;
  state.tt2.perkTokens = 3;
  delete state.tt2.inventory;
  delete state.tt2.perkEnds;
  hydrate(state);
  assert.equal(state.tt2.eventCurrency, 12);
  assert.equal(state.tt2.perkTokens, 3);
  assert.deepEqual(state.tt2.inventory, []);
  assert.deepEqual(state.tt2.perkEnds, [[], []]);
});

test('migration keeps every saved array at the slot count the Sheets format pins', () => {
  const state = legacySave();
  // Simulate an older save whose arrays were shorter than the current format.
  state.heroes = [1, 2, 3];
  state.artifacts = [4, 5];
  state.skillLevels = [];
  hydrate(state);
  assert.equal(state.heroes.length, 33);
  assert.equal(state.artifacts.length, 30);
  assert.equal(state.skillLevels.length, 6);
  assert.deepEqual(state.heroes.slice(0, 3), [1, 2, 3]);
  assert.deepEqual(state.heroes.slice(3), Array(30).fill(0));
  assert.doesNotThrow(() => validateSnapshot({ name: '冒險者', state }));
});

test('a cloud snapshot an older build wrote is readable, but never writable in that shape', () => {
  const state = legacySave();
  state.heroes = [1, 2, 3];
  state.artifacts = [4, 5];
  const snapshot = { name: '冒險者', state };
  // The upload path must refuse a snapshot outside the pinned Sheets slot counts.
  assert.throws(() => validateSnapshot(snapshot), /存檔格式不正確/);
  // The read path accepts it, hydrate normalises the slots, and the result is then strictly valid.
  assert.doesNotThrow(() => validateSnapshot(snapshot, { slots: 'lenient' }));
  hydrate(snapshot.state);
  assert.equal(snapshot.state.heroes.length, 33);
  assert.equal(snapshot.state.artifacts.length, 30);
  assert.deepEqual(snapshot.state.heroes.slice(0, 3), [1, 2, 3]);
  assert.doesNotThrow(() => validateSnapshot(snapshot));
});

test('lenient reading still rejects the things that make a snapshot unusable', () => {
  const base = () => ({ name: '冒險者', state: structuredClone(fresh(1000)) });
  const wrongVersion = base(); wrongVersion.state.version = 1;
  const notArray = base(); notArray.state.heroes = 'lots';
  const nonFinite = base(); nonFinite.state.gold = Number.POSITIVE_INFINITY;
  const noName = base(); noName.name = '   ';
  for (const bad of [wrongVersion, notArray, noName]) {
    assert.throws(() => validateSnapshot(bad, { slots: 'lenient' }), /存檔格式不正確/);
  }
  assert.throws(() => validateSnapshot(nonFinite, { slots: 'lenient' }), /存檔數值不正確/);
  const huge = base(); huge.state.log = Array(500).fill('x'.repeat(200));
  assert.throws(() => validateSnapshot(huge, { slots: 'lenient' }), /存檔超過容量限制/);
});
