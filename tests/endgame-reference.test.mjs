import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCatalogs, loadCatalogs } from '../tools/reference-validation.mjs';
const catalogs = loadCatalogs();

test('endgame source variants preserve matching IDs with different activation and values', () => {
  const get = (table, id) => catalogs[table].records.find(r => r.id === id).values;
  assert.equal(get('EndgamePetInfo', 'SeasonalPet1').IsActive, 'TRUE');
  assert.equal(get('EndgamePetInfo_1', 'SeasonalPet1').IsActive, 'FALSE');
  assert.equal(get('EndgameSeasonArtifactInfo', 'SeasonalArtifact1').GrowthExpo, '6.631');
  assert.equal(get('EndgameSeasonArtifactInfo_1', 'SeasonalArtifact1').GrowthExpo, '6.685');
  const report = auditCatalogs(catalogs);
  assert.ok(report.classifications.EndgamePetInfo.every(r => r.liveAvailability === 'unknown'));
  assert.equal(report.deferredReferences.filter(r => r.field === 'RankReward').length, 8);
});

test('gemstone source weights retain their original sum and separate progression ranges', () => {
  assert.equal(catalogs.GemstoneLevelCost.records.length, 5000);
  assert.equal(catalogs.GemstoneLevelSummonRateInfo.records.length, 1000);
  const row = catalogs.GemstoneLevelSummonRateInfo.records[0].values;
  assert.equal([0,1,2,3,4].reduce((sum,r) => sum + Number(row[`Rarity${r}`]), 0), 99998);
  assert.equal(row.Rarity0_Chance, '72.82%');
  const broken = structuredClone(catalogs);
  broken.GemstoneRarityInfo.records = broken.GemstoneRarityInfo.records.filter(r => r.id !== '4');
  broken.GemstoneLevelSummonRateInfo.records[0].values.Rarity0 = '-1';
  const report = auditCatalogs(broken);
  assert.ok(report.errors.some(e => e.includes('invalid nonnegative weight')));
  assert.ok(report.unresolved.some(r => r.target === 'GemstoneRarityInfo' && r.value === '4'));
});

test('pet quest progression validates each ten-entry difficulty vector rather than treating it as one number', () => {
  const row = catalogs.PetQuestLevelInfo.records.find(r => r.id === 'DifficultyChancePerLevel');
  assert.equal(row.values.LVL1.split(',').length, 10);
  assert.equal(catalogs.PetQuestLevelInfo.records.find(r => r.id === 'QuestSlots').values.LVL120, '4');
  assert.deepEqual(auditCatalogs(catalogs).errors, []);
  const broken = structuredClone(catalogs);
  broken.PetQuestLevelInfo.records.find(r => r.id === row.id).values.LVL1 = '0.98,0.02';
  assert.ok(auditCatalogs(broken).errors.some(e => e.includes('invalid difficulty probability vector')));
});
