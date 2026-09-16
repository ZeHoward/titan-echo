import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditCatalogs, classify, loadCatalogs, referenceRoot } from '../tools/reference-validation.mjs';
const catalogs = loadCatalogs();
const report = auditCatalogs(catalogs);
const load = name => JSON.parse(readFileSync(new URL(name + '.json', referenceRoot), 'utf8'));
const evidence = load('servervars-parser-evidence');

test('bundled server variables are kept as package defaults, not as live server values', () => {
  assert.deepEqual(report.errors, []);
  assert.equal(catalogs.ServerVarsInfo.records.length, 12);
  assert.deepEqual(Object.keys(catalogs.ServerVarsInfo.schema), ['ServerVarsKey', 'iOS', 'Google', 'Amazon', 'New?']);
  assert.deepEqual(evidence.parsers.ServerVarsInfo.valueColumns, ['iOS', 'Google', 'Amazon']);
  const pinned = Object.fromEntries(load('manifest').tables.map(entry => [entry.table, entry.sourceSha256]));
  for (const table of ['ServerVarsInfo', 'ServerVarOverride']) {
    // The imported source is the same file the native audit disassembled against.
    assert.equal(pinned[table], evidence.sourceSha256[table]);
    for (const row of report.classifications[table]) {
      assert.equal(row.scope, 'bundled-server-variable');
      assert.equal(row.liveAvailability, 'unknown');
      assert.ok(row.evidence.includes('live-server-value=unknown'));
    }
  }
  const maxStage = catalogs.ServerVarsInfo.records.find(row => row.id === 'maxStage');
  assert.deepEqual([maxStage.values.iOS, maxStage.values.Google, maxStage.values.Amazon], ['98000', '98000', '98000']);
  assert.equal(maxStage.activation, 'unverified');
});

test('the duplicated override key resolves by the verified native last-parsed-row policy', () => {
  const data = catalogs.ServerVarOverride;
  assert.equal(data.rowResolution.policy, evidence.policy);
  assert.equal(evidence.policy, 'last-parsed-row-wins');
  assert.equal(data.rowResolution.sourceRows, 26);
  assert.equal(data.rowResolution.effectiveRows, 25);
  assert.equal(data.records.length, 25);
  const history = data.rowResolution.duplicateHistory.pet_paradise_shovel_purchase_daily_limit;
  assert.deepEqual(history.map(row => [row.sourceOrdinal, row.values.Value]), [[14, '3'], [18, '3']]);
  assert.equal(data.records.find(row => row.id === 'pet_paradise_shovel_purchase_daily_limit').sourceOrdinal, 18);
  assert.equal(evidence.parsers.ServerVarOverride.assignmentTarget, 'Dictionary<object, object>.set_Item');
  assert.deepEqual(load('quarantine').resolved.map(entry => entry.table).sort(),
    ['C_EquipmentEnhancementScalingInfo', 'ServerVarOverride']);
});

test('scheduled bonuses stay unimported because the client reads them from a server dictionary', () => {
  const [deferred] = load('quarantine').tables.filter(entry => entry.table === 'ScheduledBonusInfo');
  assert.equal(deferred.status, 'not-imported');
  assert.equal(deferred.runtimeEnabled, false);
  assert.equal(deferred.sourceRows, 4);
  assert.equal(deferred.rowsWithKey, 1);
  assert.equal(deferred.noteOnlyRows, 3);
  assert.ok(deferred.nativeMembers.every(member => /Dictionary<string, object>/.test(member.signature)));
  assert.equal(catalogs.ScheduledBonusInfo, undefined);
});

test('titan scaling variants are reported side by side without choosing a live A/B sheet', () => {
  assert.equal(evidence.abTestSelection.requestedSheet, 'TitanScalingInfo');
  assert.equal(evidence.abTestSelection.variantInUse, 'unknown: the assigned A/B sheet name is not in the package');
  const variants = Object.fromEntries(report.sourceVariants.map(entry => [entry.table, entry]));
  assert.deepEqual(variants.TitanScalingInfo_A.added, ['105', '110', '120', '200', '500']);
  assert.deepEqual(variants.TitanScalingInfo_A.changed, []);
  assert.deepEqual(variants.TitanScalingInfo_B.added, ['2', '3', '4', '5']);
  assert.deepEqual(variants.TitanScalingInfo_B.changed, ['1']);
  assert.equal(catalogs.TitanScalingInfo.records.find(row => row.id === '1').values.BonusAmountA, '1.00E+00');
  assert.equal(catalogs.TitanScalingInfo_B.records.find(row => row.id === '1').values.BonusAmountA, '3.00E-01');
  for (const table of ['ArtifactCostInfo_A', 'TitanScalingInfo_C']) {
    assert.equal(variants[table].identicalToBase, true);
  }
  assert.ok(report.sourceVariants.every(entry => entry.liveSelection === 'unknown' && entry.runtimeEnabled === false));
  for (const table of ['TitanScalingInfo', 'TitanScalingInfo_A', 'TitanScalingInfo_B', 'TitanScalingInfo_C']) {
    assert.ok(report.classifications[table].every(row =>
      row.scope === 'ab-test-source-variant' && row.evidence.includes('ab-sheet-assignment=unknown')));
  }
});

test('every imported alternate source is diffed against its base table', () => {
  const variants = report.sourceVariants.map(entry => entry.table).sort();
  assert.deepEqual(variants, ['ArtifactCostInfo_A', 'EndgamePetInfo_1', 'EndgameSeasonArtifactInfo_1',
    'EndgameSeasonRewardInfo_1', 'NewPrizeInfoDoc', 'RaidMasterTierRewardInfo_1', 'TitanScalingInfo_A',
    'TitanScalingInfo_B', 'TitanScalingInfo_C']);
  for (const entry of report.sourceVariants) {
    assert.ok(catalogs[entry.baseTable], entry.table);
    // Column sets may differ between alternate sources, so the diff states exactly what it compared.
    const here = new Set(Object.keys(catalogs[entry.table].schema));
    const base = new Set(Object.keys(catalogs[entry.baseTable].schema));
    assert.deepEqual(entry.sharedColumns, [...here].filter(column => base.has(column)).sort());
    assert.deepEqual(entry.variantOnlyColumns, [...here].filter(column => !base.has(column)).sort());
    assert.deepEqual(entry.baseOnlyColumns, [...base].filter(column => !here.has(column)).sort());
    assert.ok(entry.sharedColumns.length > 0, entry.table);
    assert.equal(classify(entry.table, catalogs[entry.table].records[0], catalogs).evidence
      .includes(`base-table=${entry.baseTable}`), true);
  }
});

test('broken server variable and scaling rows are reported instead of being smoothed over', () => {
  const cases = [
    ['ServerVarOverride', 'Value', '', /missing server var value/],
    ['TitanScalingInfo_A', 'Stage', '0', /Stage: invalid positive integer/],
    ['TitanScalingInfo_B', 'ThemeMultiplierSequence', '2,x,4', /invalid multiplier list/],
    ['ArtifactCostInfo_A', 'RelicCost', 'lots', /RelicCost: invalid decimal/],
  ];
  for (const [table, field, value, expected] of cases) {
    const broken = structuredClone(catalogs);
    broken[table].records[0].values[field] = value;
    assert.ok(auditCatalogs(broken).errors.some(error => expected.test(error)), `${table}.${field}`);
  }
});
