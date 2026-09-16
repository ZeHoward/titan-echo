import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TT2_ARRAY_KEYS, indexListOrder, migrateIndexList, migrateSetPieces, tt2IdOrder }
  from '../lib/tt2-save-ids.ts';
import { TT2_RULESET, TT2_ARTIFACTS, TT2_TREE } from '../lib/tt2-rules.ts';
import { TT2_PETS, TT2_HEROES } from '../lib/tt2-data.ts';
import { fresh } from '../lib/engine.ts';

const read = table => JSON.parse(readFileSync(
  new URL(`../reference/tt2/8.2.0/${table}.json`, import.meta.url), 'utf8')).records.map(r => r.id);

test('the TT2 block arrays name the catalog ID behind every slot', () => {
  const order = tt2IdOrder(TT2_RULESET);
  assert.deepEqual(order.artifacts, TT2_ARTIFACTS.map(a => a.id));
  assert.deepEqual(order.spent, order.artifacts);
  assert.deepEqual(order.tree, TT2_TREE.map(t => t.id));
  assert.deepEqual(order.petLevels, TT2_PETS.map(p => p.id));
  assert.deepEqual(order.scrolls, TT2_HEROES.map(h => h.id));
  const state = fresh(0);
  for (const key of TT2_ARRAY_KEYS) {
    assert.equal(state.tt2[key].length, order[key].length, key);
    assert.equal(new Set(order[key]).size, order[key].length, key);
  }
  assert.throws(() => tt2IdOrder('tt2-9.9.9'), /未知的規則版本/);
});

test('the six talents 8.2 adds do not displace any talent a save already has', () => {
  const from = tt2IdOrder(TT2_RULESET);
  const catalog = read('SkillTreeInfo2.0');
  const added = catalog.filter(id => !from.tree.includes(id));
  // R02 recorded exactly six new talents against the 7.5 snapshot.
  assert.equal(added.length, 6);
  const levels = from.tree.map((_, i) => (i % 5) + 1);
  const moved = migrateTree(levels, from.tree, catalog);
  assert.equal(moved.length, catalog.length);
  for (const [index, id] of catalog.entries()) {
    const source = from.tree.indexOf(id);
    assert.equal(moved[index], source === -1 ? 0 : levels[source], id);
  }
  // Each added talent starts unlearned instead of inheriting another talent's level.
  for (const id of added) assert.equal(moved[catalog.indexOf(id)], 0, id);
  // Keeping the old indices would give at least one talent the wrong level.
  assert.notDeepEqual(catalog.map((_, i) => levels[i] ?? 0), moved);
});

test('the twenty-eight sets 8.2 adds do not renumber a completed set', () => {
  const lists = indexListOrder(TT2_RULESET);
  const catalog = read('EquipmentSetInfo');
  const added = catalog.filter(id => !lists.sets.includes(id));
  assert.equal(added.length, 28);
  // A save that completed the first, middle and last set of the 7.5 catalog.
  const completed = [0, Math.floor(lists.sets.length / 2), lists.sets.length - 1];
  const names = completed.map(index => lists.sets[index]);
  const { list, dropped } = migrateIndexList(completed, lists.sets, catalog);
  assert.deepEqual(dropped, []);
  assert.deepEqual(list.map(index => catalog[index]), names);
  // Index-based reuse would point at a different set for at least one of them.
  assert.notDeepEqual(completed.map(index => catalog[index]), names);
});

test('set pieces follow their set, and a set the catalog drops is reported', () => {
  const lists = indexListOrder(TT2_RULESET);
  const catalog = read('EquipmentSetInfo');
  const pieces = [{ set: 2, slot: 1 }, { set: 5, slot: 3 }];
  const moved = migrateSetPieces(pieces, lists.sets, catalog);
  assert.deepEqual(moved.dropped, []);
  assert.deepEqual(moved.pieces.map(p => [catalog[p.set], p.slot]),
    pieces.map(p => [lists.sets[p.set], p.slot]));
  // Drop one set from the target catalog: its progress is reported, the rest still moves.
  const removed = lists.sets[2];
  const shrunk = catalog.filter(id => id !== removed);
  const partial = migrateSetPieces(pieces, lists.sets, shrunk);
  assert.deepEqual(partial.dropped, [removed]);
  assert.equal(partial.pieces.length, 1);
  assert.equal(shrunk[partial.pieces[0].set], lists.sets[5]);
  // An index the source order never had is reported rather than silently kept.
  const bogus = migrateIndexList([9999], lists.sets, catalog);
  assert.deepEqual(bogus.list, []);
  assert.deepEqual(bogus.dropped, ['索引 9999']);
});

test('every TT2 slot ID still resolves in the 8.2 catalogs', () => {
  const legacy = JSON.parse(readFileSync(
    new URL('../reference/tt2/8.2.0/legacy-2.6.json', import.meta.url), 'utf8')).catalogs;
  const order = tt2IdOrder(TT2_RULESET);
  const lists = indexListOrder(TT2_RULESET);
  for (const [catalog, ids] of [['TT2_ARTIFACTS', order.artifacts], ['TT2_TREE', order.tree],
    ['TT2_PETS', order.petLevels], ['TT2_HEROES', order.scrolls], ['TT2_SETS', lists.sets]]) {
    const targets = new Map(legacy[catalog].entries.map(e => [e.id, e.targetId]));
    const unmapped = ids.filter(id => targets.get(id) !== id);
    assert.deepEqual(unmapped, [], `${catalog} 有無法對應到 8.2 的 ID`);
  }
});

function migrateTree(levels, fromIds, toIds) {
  const byId = new Map(fromIds.map((id, index) => [id, levels[index] ?? 0]));
  return toIds.map(id => byId.get(id) ?? 0);
}
