import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCatalogs, loadCatalogs } from '../tools/reference-validation.mjs';

const catalogs = loadCatalogs();
test('raid catalogs preserve card levels, cost boundaries and player deck progression', () => {
  assert.equal(catalogs.RaidSkillInfo.records.length, 44);
  assert.equal(catalogs.RaidSkillCardCostInfo.records.length, 150);
  assert.equal(catalogs.RaidPlayerInfo.records.length, 3000);
  assert.equal(catalogs.RaidEnemyInfo.records.length, 10);
  assert.equal(catalogs.RaidEnemyPartInfo.records.length, 66);
  const moon = catalogs.RaidSkillInfo.records.find(r => r.id === 'MoonBeam');
  assert.equal(moon.values.A1, '6.052');
  assert.equal(moon.values.A150, '52.647');
  assert.equal(catalogs.RaidPlayerInfo.records.find(r => r.id === '3').values.SkillsPerDeck, '1');
  assert.equal(catalogs.RaidPlayerInfo.records.find(r => r.id === '4').values.SkillsPerDeck, '2');
  const report = auditCatalogs(catalogs);
  assert.deepEqual(report.unresolved, []);
  assert.ok(report.referenceCounts['RaidPlayerInfo.PlayerRaidProgressionBundle -> ShopBundleInfo'] > 0);
  assert.ok(!report.deferredReferences.some(r => r.table === 'RaidPlayerInfo'));
  assert.ok(report.classifications.RaidSkillInfo.every(r => r.scope === 'raid' && r.activation === 'unverified'));
});

test('missing level effects and missing cost rows cannot silently shorten card progression', () => {
  const broken = structuredClone(catalogs);
  broken.RaidSkillInfo.records[0].values.A150 = '-';
  broken.RaidSkillCardCostInfo.records = broken.RaidSkillCardCostInfo.records.filter(r => r.id !== '150');
  const report = auditCatalogs(broken);
  assert.ok(report.errors.some(e => e.includes('A150: missing card level value')));
  assert.ok(report.unresolved.some(r => r.value === '150' && r.target === 'RaidSkillCardCostInfo'));
});

test('body links and bonus slots E through H are included in reference checks', () => {
  const broken = structuredClone(catalogs);
  broken.RaidEnemyPartInfo.records[1].values.LinkedParts = 'BodyHead,MissingPart';
  broken.RaidEnemyInfo.records[0].values.BonusTypeH = 'InventedEnemyEffect';
  broken.RaidSkillInfo.records[0].values.BonusTypeE = 'InventedCardEffect';
  const report = auditCatalogs(broken);
  for (const value of ['MissingPart', 'InventedEnemyEffect', 'InventedCardEffect']) {
    assert.ok(report.unresolved.some(r => r.value === value));
  }
});

test('raid flags, probabilities and upgrade costs reject invalid data while allowing signed bonuses', () => {
  const broken = structuredClone(catalogs);
  broken.RaidSkillInfo.records[0].values.Chance = '1.01';
  broken.RaidSkillCardCostInfo.records[0].values.Cost = '-1';
  broken.RaidEnemyPartInfo.records[0].values.HasHealth = 'yes';
  const report = auditCatalogs(broken);
  assert.ok(report.errors.some(e => e.includes('invalid probability')));
  assert.ok(report.errors.some(e => e.includes('invalid nonnegative integer')));
  assert.ok(report.errors.some(e => e.includes('HasHealth: invalid flag')));
  assert.deepEqual(auditCatalogs(catalogs).errors, []);
  assert.equal(catalogs.RaidEnemyInfo.records[0].values.BonusAmountC, '-0.20');
});
