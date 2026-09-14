import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditCatalogs, loadCatalogs, referenceRoot } from '../tools/reference-validation.mjs';

const catalogs = loadCatalogs();

test('raid tiers retain distinct composite IDs and reference areas and enemy pools', () => {
  const levels = catalogs.RaidLevelInfo;
  assert.equal(levels.records.length, 140);
  assert.deepEqual(levels.keys, ['TierID', 'LevelID']);
  assert.ok(levels.records.some(r => r.id === '["1","1"]'));
  assert.ok(levels.records.some(r => r.id === '["5","1"]'));
  assert.equal(catalogs.RaidAreaInfo.records.length, 7);
  assert.equal(levels.records[0].values.EnemyIDs, 'Enemy5,Enemy2');
  assert.equal(levels.records[0].values.TitanCount, '3');
  // EnemyIDs is a pool; its length must not be equated to the encounter count.
  assert.deepEqual(auditCatalogs(catalogs).errors, []);
});

test('bundle chains, equipment lists and card quantities resolve without activating purchases', () => {
  assert.equal(catalogs.ShopBundleInfo.records.length, 639);
  const report = auditCatalogs(catalogs);
  assert.deepEqual(report.unresolved, []);
  assert.ok(report.classifications.ShopBundleInfo.every(r => r.activation === 'unverified' && r.liveAvailability === 'unknown'));
  assert.ok(report.deferredReferences.some(r => r.field === 'DailyDeliveryID'));
  assert.ok(report.deferredReferences.some(r => r.field === 'RewardString'));
  assert.equal(report.deferredReferences.filter(r => r.table === 'RaidPlayerInfo').length, 0);
});

test('missing targets and malformed card quantities produce precise validation failures', () => {
  const broken = structuredClone(catalogs);
  broken.ShopBundleInfo.records[0].values.RaidCardID = 'MoonBeam:bad';
  broken.ShopBundleInfo.records[0].values.UnlockNextBundle = 'MissingBundle';
  broken.RaidLevelInfo.records[0].values.EnemyIDs = 'Enemy5,MissingEnemy';
  broken.RaidLevelInfo.records[0].values.AreaID = 'MissingArea';
  broken.RaidAreaInfo.records[0].values.BonusTypeJ = 'MissingLateBonus';
  const report = auditCatalogs(broken);
  assert.ok(report.errors.some(e => e.includes('invalid ID quantity')));
  for (const value of ['MissingBundle', 'MissingEnemy', 'MissingArea', 'MissingLateBonus']) {
    assert.ok(report.unresolved.some(r => r.value === value));
  }
});

test('sprite atlas is indexed separately from gameplay tables and covers non-sentinel parts', () => {
  const atlas = JSON.parse(readFileSync(new URL('raid-layout-index.json', referenceRoot), 'utf8'));
  assert.equal(atlas.sourceFormat, 'sprite-atlas-json');
  assert.equal(atlas.runtimeEnabled, false);
  assert.equal(catalogs.RaidEnemyLayout, undefined);
  assert.deepEqual(atlas.frameIds, catalogs.RaidEnemyPartInfo.records.map(r => r.id).filter(id => id !== 'None').sort());
  assert.equal(atlas.frameIds.length, 65);
});
