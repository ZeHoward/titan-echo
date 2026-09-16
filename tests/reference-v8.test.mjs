import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const base = new URL('../reference/tt2/8.2.0/', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name + '.json', base), 'utf8'));
const manifest = read('manifest');

test('8.2 reference catalogs are complete against their manifest and uniquely keyed', () => {
  assert.equal(manifest.runtimeEnabled, false);
  assert.equal(manifest.tables.length, 133);
  assert.equal(manifest.resourceIndex.length, 372);
  for (const entry of manifest.tables) {
    const bytes = readFileSync(new URL(entry.table + '.json', base));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.catalogSha256);
    const table = JSON.parse(bytes);
    assert.equal(table.records.length, entry.rows);
    assert.equal(new Set(table.records.map(r => r.id)).size, entry.rows);
    for (const row of table.records) {
      assert.equal(row.activation, 'unverified');
      assert.equal(row.verification, 'pending');
      assert.deepEqual(Object.keys(row.values), Object.keys(table.schema));
      assert.ok(Object.values(row.values).every(v => typeof v === 'string'));
    }
  }
});

test('old array positions resolve by stable ID despite reordered equipment sets', () => {
  const legacy = read('legacy-2.6');
  for (const catalog of Object.values(legacy.catalogs)) {
    const target = new Set(read(catalog.table).records.map(r => r.id));
    catalog.entries.forEach((entry, i) => {
      assert.equal(entry.legacyIndex, i);
      assert.equal(entry.targetId, target.has(entry.id) ? entry.id : null);
    });
  }
  const sets = read('EquipmentSetInfo');
  assert.equal(sets.records[0].id, 'StainGlass');
  assert.notEqual(legacy.catalogs.TT2_SETS.entries[0].id, sets.records[0].id);
  assert.equal(sets.differenceFrom75.added.length, 28);
  assert.equal(read('SkillTreeInfo2.0').differenceFrom75.added.length, 6);
});

test('large decimals and source missing markers survive without numeric conversion', () => {
  const milestones = read('PlayerImprovementsInfo');
  assert.ok(milestones.records.some(r => Number(r.values.TotalNew) === Infinity));
  assert.ok(milestones.records.every(r => r.values.TotalNew !== 'Infinity'));
  const tree = read('SkillTreeInfo2.0');
  const values = tree.records.flatMap(r => Object.values(r.values));
  assert.ok(values.includes('-'));
  assert.ok(values.includes('0'));
  assert.equal(read('HelperImprovementsInfo').records.length, 1015);
});

test('event evidence is preserved without declaring an active schedule', () => {
  const daily = read('DailyRewardsInfo');
  assert.ok(daily.schema.AnniversaryMinigameCurrency);
  assert.ok(read('C_EquipmentInfo').records.some(r => r.availabilityEvidence.LimitedTime.toLowerCase() === 'true'));
  assert.equal(read('PerkInfo').records.length, 19);
});
