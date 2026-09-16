import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SAVE_ARRAY_KEYS, SAVE_SLOTS, SKILL_SAVE_ORDER, describeSaveIds, migrateSaveArrays, saveIdOrder }
  from '../lib/tt2-save-ids.ts';
import { TT2_HEROES } from '../lib/tt2-data.ts';
import { TT2_ARTIFACTS, TT2_ACTIVE, TT2_RULESET } from '../lib/tt2-rules.ts';
import { fresh } from '../lib/engine.ts';
import { validateSnapshot } from '../lib/sheets-cloud.ts';

test('every save slot names the catalog ID the runtime actually indexes', () => {
  const order = saveIdOrder(TT2_RULESET);
  // The runtime reads state.heroes[i] as TT2_HEROES[i] and state.artifacts[i] as TT2_ARTIFACTS[i].
  assert.deepEqual(order.heroes, TT2_HEROES.slice(0, 33).map(h => h.id));
  assert.deepEqual(order.artifacts, TT2_ARTIFACTS.slice(0, 30).map(a => a.id));
  assert.deepEqual(order.skillLevels, SKILL_SAVE_ORDER.map(i => TT2_ACTIVE[i].id));
  assert.equal(order.heroes.length, SAVE_SLOTS.heroes);
  assert.equal(order.artifacts.length, SAVE_SLOTS.artifacts);
  assert.equal(order.skillLevels.length, SAVE_SLOTS.skillLevels);
  // Weapons, evolutions and wounded are parallel hero arrays, so they share the hero order.
  for (const key of ['weapons', 'evolutions', 'wounded']) assert.deepEqual(order[key], order.heroes);
  assert.deepEqual(order.artifactSpent, order.artifacts);
  for (const key of SAVE_ARRAY_KEYS) assert.equal(new Set(order[key]).size, order[key].length, key);
  assert.throws(() => saveIdOrder('tt2-9.9.9'), /未知的規則版本/);
});

test('a live save has exactly the slots the ID order describes', () => {
  const state = fresh(0);
  const order = saveIdOrder(TT2_RULESET);
  for (const key of SAVE_ARRAY_KEYS) assert.equal(state[key].length, order[key].length, key);
  const described = describeSaveIds();
  assert.equal(described.ruleset, TT2_RULESET);
  assert.deepEqual(Object.keys(described.arrays).sort(), [...SAVE_ARRAY_KEYS].sort());
});

test('progress follows its ID when the catalog order changes', () => {
  const from = saveIdOrder(TT2_RULESET);
  // Reverse the hero order and rotate the artifacts: same IDs, different slots.
  const to = { ...from, heroes: [...from.heroes].reverse(), weapons: [...from.heroes].reverse(),
    evolutions: [...from.heroes].reverse(), wounded: [...from.heroes].reverse(),
    artifacts: [...from.artifacts.slice(5), ...from.artifacts.slice(0, 5)],
    artifactSpent: [...from.artifacts.slice(5), ...from.artifacts.slice(0, 5)] };
  const heroes = from.heroes.map((_, i) => i + 1);
  const artifacts = from.artifacts.map((_, i) => (i + 1) * 10);
  const { arrays, dropped, added } = migrateSaveArrays({ heroes, artifacts }, from, to);
  for (const [index, id] of to.heroes.entries()) {
    assert.equal(arrays.heroes[index], heroes[from.heroes.indexOf(id)], id);
  }
  for (const [index, id] of to.artifacts.entries()) {
    assert.equal(arrays.artifacts[index], artifacts[from.artifacts.indexOf(id)], id);
  }
  assert.deepEqual(dropped, []);
  assert.deepEqual(added, []);
});

test('an ID the new order drops is reported, and a new ID starts at zero', () => {
  const from = saveIdOrder(TT2_RULESET);
  const replacement = 'Artifact_NewInThisVersion';
  const to = { ...from,
    artifacts: [...from.artifacts.slice(0, 29), replacement],
    artifactSpent: [...from.artifacts.slice(0, 29), replacement] };
  const artifacts = from.artifacts.map(() => 7);
  const { arrays, dropped, added } = migrateSaveArrays({ artifacts, artifactSpent: artifacts }, from, to);
  assert.equal(arrays.artifacts[29], 0);
  assert.deepEqual(arrays.artifacts.slice(0, 29), Array(29).fill(7));
  const removed = from.artifacts[29];
  assert.deepEqual(dropped.filter(d => d.key === 'artifacts'), [{ key: 'artifacts', id: removed, value: 7 }]);
  assert.deepEqual(added.filter(a => a.key === 'artifacts'), [{ key: 'artifacts', id: replacement, value: 0 }]);
  // A level of zero is not progress, so it is not reported as lost.
  const empty = migrateSaveArrays({ artifacts: from.artifacts.map(() => 0) }, from, to);
  assert.deepEqual(empty.dropped, []);
});

test('running the same migration twice changes nothing the second time', () => {
  const from = saveIdOrder(TT2_RULESET);
  const to = { ...from, heroes: [...from.heroes].reverse(), weapons: [...from.heroes].reverse(),
    evolutions: [...from.heroes].reverse(), wounded: [...from.heroes].reverse() };
  const heroes = from.heroes.map((_, i) => i);
  const once = migrateSaveArrays({ heroes }, from, to);
  const twice = migrateSaveArrays(once.arrays, to, to);
  assert.deepEqual(twice.arrays.heroes, once.arrays.heroes);
  assert.deepEqual(twice.dropped, []);
  assert.deepEqual(twice.added, []);
  // Re-migrating the already-migrated arrays with the original pair would double-move them,
  // so the identity migration is what a repeat run must use.
  const identity = migrateSaveArrays({ heroes }, from, from);
  assert.deepEqual(identity.arrays.heroes, heroes);
  assert.deepEqual(identity.dropped, []);
});

test('a slot count change is refused unless the caller has opted in', () => {
  const from = saveIdOrder(TT2_RULESET);
  const to = { ...from, heroes: [...from.heroes, 'H_Extra'], weapons: [...from.heroes, 'H_Extra'],
    evolutions: [...from.heroes, 'H_Extra'], wounded: [...from.heroes, 'H_Extra'] };
  const heroes = from.heroes.map(() => 1);
  assert.throws(() => migrateSaveArrays({ heroes }, from, to), /欄位數量改變需要先測試相容遷移/);
  const forced = migrateSaveArrays({ heroes }, from, to, { allowSlotCountChange: true });
  assert.equal(forced.arrays.heroes.length, 34);
  assert.equal(forced.arrays.heroes[33], 0);
});

test('a migrated save still passes the Sheets snapshot format check', () => {
  const state = fresh(0);
  const from = saveIdOrder(TT2_RULESET);
  const to = { ...from, artifacts: [...from.artifacts].reverse(), artifactSpent: [...from.artifacts].reverse() };
  const { arrays } = migrateSaveArrays(state, from, to);
  const migrated = { ...state, ...arrays };
  assert.equal(migrated.heroes.length, 33);
  assert.equal(migrated.artifacts.length, 30);
  assert.doesNotThrow(() => validateSnapshot({ name: '冒險者', state: migrated }));
});

test('every save slot ID still exists in the 8.2 catalog', () => {
  const legacy = JSON.parse(readFileSync(new URL('../reference/tt2/8.2.0/legacy-2.6.json', import.meta.url), 'utf8'));
  const order = saveIdOrder(TT2_RULESET);
  for (const [catalog, key] of [['TT2_HEROES', 'heroes'], ['TT2_ARTIFACTS', 'artifacts'], ['TT2_ACTIVE', 'skillLevels']]) {
    const targets = new Map(legacy.catalogs[catalog].entries.map(e => [e.id, e.targetId]));
    for (const id of order[key]) {
      assert.ok(targets.has(id), `${catalog}: ${id} 不在舊 ID 對照中`);
      assert.equal(targets.get(id), id, `${catalog}: ${id} 在 8.2 沒有對應`);
    }
  }
});

test('index-based migration would put four of the six skill slots on the wrong skill', () => {
  const order = saveIdOrder(TT2_RULESET);
  const read = table => JSON.parse(readFileSync(
    new URL(`../reference/tt2/8.2.0/${table}.json`, import.meta.url), 'utf8')).records.map(r => r.id);
  // Heroes and artifacts happen to sit at the same index in 8.2, so index migration looks safe there.
  for (const [table, key] of [['ArtifactInfo', 'artifacts'], ['HelperInfo', 'heroes']]) {
    const rows = read(table);
    assert.deepEqual(order[key].filter((id, i) => rows.indexOf(id) !== i), []);
  }
  // Skills do not: the save order is a display order, so position and catalog index disagree.
  const skills = read('ActiveSkillInfo');
  const misplaced = order.skillLevels.filter((id, i) => skills.indexOf(id) !== i);
  assert.deepEqual(misplaced, ['ShadowClone', 'HelperBoost', 'HandOfMidas', 'BurstDamage']);
  // Moving by ID puts every one of them back where it belongs.
  const byId = { ...saveIdOrder(TT2_RULESET), skillLevels: skills.slice(0, 6) };
  const levels = order.skillLevels.map((_, i) => i + 1);
  const { arrays } = migrateSaveArrays({ skillLevels: levels }, order, byId);
  for (const [index, id] of byId.skillLevels.entries()) {
    const source = order.skillLevels.indexOf(id);
    assert.equal(arrays.skillLevels[index], source === -1 ? 0 : levels[source], id);
  }
});
