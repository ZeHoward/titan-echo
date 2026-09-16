import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditCatalogs, loadCatalogs, loadNativeServerVarFields, referenceRoot } from '../tools/reference-validation.mjs';
const catalogs = loadCatalogs();
const report = auditCatalogs(catalogs);
const load = name => JSON.parse(readFileSync(new URL(name + '.json', referenceRoot), 'utf8'));

test('challenge tournament starting rows rebuild their own bonus list from the slot columns', () => {
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.unresolved, []);
  const data = catalogs.ChallengeTournamentStartingInfo;
  assert.equal(data.records.length, 16);
  assert.deepEqual(data.keys, ['TourneyID']);
  // The display name is a label, not data, so it stays out of the catalog.
  assert.ok(data.omittedColumns.includes('TourneyType'));
  assert.ok(!Object.hasOwn(data.schema, 'TourneyType'));
  for (const row of data.records) {
    const slots = 'ABCDEFGHI'.split('').map(slot => row.values[`BonusType${slot}`]).filter(Boolean);
    assert.equal(slots.join(','), row.values.StartingBonusTypes, row.id);
    for (const pair of slots) {
      const [id, amount] = pair.split(':');
      assert.ok(catalogs.BonusInfo.records.some(bonus => bonus.id === id), pair);
      assert.ok(amount !== undefined && amount !== '', pair);
    }
  }
  assert.equal(report.challengeStartingChecks.length, 16);
  assert.ok(report.referenceCounts['ChallengeTournamentStartingInfo.BonusType -> BonusInfo'] > 0);
});

test('a bonus pair column is never read as a bare bonus ID', () => {
  const broken = structuredClone(catalogs);
  const row = broken.ChallengeTournamentStartingInfo.records[0];
  row.values.BonusTypeA = 'NotARealBonus:0.9';
  row.values.StartingBonusTypes = ['NotARealBonus:0.9', ...'BCDEFGHI'.split('')
    .map(slot => row.values[`BonusType${slot}`]).filter(Boolean)].join(',');
  const result = auditCatalogs(broken);
  assert.ok(result.unresolved.some(r => r.value === 'NotARealBonus' && r.target === 'BonusInfo'));
  // The amount half of the pair must not be mistaken for an identifier.
  assert.ok(!result.unresolved.some(r => r.value === 'NotARealBonus:0.9'));
});

test('starting passive levels agree with the sibling columns that repeat them', () => {
  for (const row of catalogs.ChallengeTournamentStartingInfo.records) {
    const passives = row.values.StartingPassiveLevels.split(',').map(pair => pair.split(':'));
    assert.equal(passives.length, 8, row.id);
    for (const [name, value] of passives) assert.equal(row.values[name], value, `${row.id}.${name}`);
  }
  const broken = structuredClone(catalogs);
  broken.ChallengeTournamentStartingInfo.records[0].values.SilentMarch = '999';
  assert.ok(auditCatalogs(broken).errors.some(e => /SilentMarch disagrees with its column/.test(e)));
});

test('discovery pools and starting inventory resolve to the catalogs they name', () => {
  const pools = new Set(Object.keys(catalogs.ChallengeTournamentArtifactPools.schema));
  for (const row of catalogs.ChallengeTournamentStartingInfo.records) {
    assert.ok(pools.has(row.values.DiscoveryPool), row.id);
  }
  assert.equal(report.referenceCounts['ChallengeTournamentStartingInfo.DiscoveryPool -> ChallengeTournamentArtifactPools'], 16);
  assert.ok(report.referenceCounts['ChallengeTournamentStartingInfo.EquippedInventory -> C_EquipmentInfo'] > 0);
  assert.ok(report.referenceCounts['ChallengeTournamentStartingInfo.HiddenInventory -> PetInfo'] > 0);
  const broken = structuredClone(catalogs);
  broken.ChallengeTournamentStartingInfo.records[0].values.DiscoveryPool = 'Z';
  assert.ok(auditCatalogs(broken).unresolved.some(r => r.field === 'DiscoveryPool' && r.value === 'Z'));
});

test('nine bundled server var keys have no client field to bind to, and that is recorded', () => {
  const fields = loadNativeServerVarFields();
  assert.equal(fields.size, 953);
  assert.equal(load('native-server-var-fields').attribute, 'ServerVar');
  const binding = report.serverVarBinding;
  assert.equal(binding.checked, 37);
  assert.equal(binding.bound, 28);
  assert.equal(binding.unbound.length, 9);
  assert.deepEqual(binding.unbound.filter(e => e.table === 'ServerVarOverride').map(e => e.key).sort(),
    ['EquipmentLevelReductionAmount', 'EquipmentLevelReductionMin']);
  assert.equal(binding.unbound.filter(e => e.table === 'ServerVarsInfo').length, 7);
  for (const entry of binding.unbound) assert.ok(!fields.has(entry.key), entry.key);
  // Unbound keys stay in the catalog; they are evidence of sheet drift, not rows to delete.
  const keys = new Set(catalogs.ServerVarsInfo.records.map(r => r.id)
    .concat(catalogs.ServerVarOverride.records.map(r => r.id)));
  for (const entry of binding.unbound) assert.ok(keys.has(entry.key), entry.key);
  assert.ok(fields.has('maxStage') && fields.has('fairyRareEquipmentMaxStageCheckMult'));
});

test('tournament server var overrides must name a real client field', () => {
  assert.ok(report.referenceCounts['ChallengeTournamentStartingInfo.ServerVarOverrides -> native ServerVar field'] > 0);
  const broken = structuredClone(catalogs);
  broken.ChallengeTournamentStartingInfo.records[0].values.ServerVarOverrides = 'notAServerVar;5';
  assert.ok(auditCatalogs(broken).unresolved.some(r =>
    r.field === 'ServerVarOverrides' && r.value === 'notAServerVar'));
});
