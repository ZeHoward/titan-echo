import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditCatalogs, loadCatalogs, referenceRoot } from '../tools/reference-validation.mjs';
const catalogs = loadCatalogs();
const report = auditCatalogs(catalogs);
const load = name => JSON.parse(readFileSync(new URL(name + '.json', referenceRoot), 'utf8'));

test('shop, ad chest and pet paradise tables import with keys that survive their repeated columns', () => {
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.unresolved, []);
  for (const [table, rows, keys] of [['ShopDisplayInfo', 18, ['chestID']],
    ['AdChestInfo', 83, ['ChestType', 'Tier', 'RewardCategoryTier', 'RewardTier']],
    ['NewPrizeInfoDoc', 273, ['PrizeID', 'TierID', 'StartRank', 'PrizeType']],
    ['PetParadiseLevelInfo', 2011, ['BoardNumber']]]) {
    assert.equal(catalogs[table].records.length, rows, table);
    assert.deepEqual(catalogs[table].keys, keys, table);
    assert.equal(new Set(catalogs[table].records.map(r => r.id)).size, rows, table);
  }
  // Ad chest rows repeat everything except the reward category when the reward tier is None.
  const noneRows = catalogs.AdChestInfo.records.filter(r => r.values.RewardTier === 'None');
  assert.ok(noneRows.length > 1);
  assert.ok(new Set(noneRows.map(r => r.values.RewardCategoryTier)).size > 1);
  assert.ok(report.classifications.ShopDisplayInfo.every(r => r.scope === 'shop-listing'
    && r.evidence.includes('live-price-and-availability=unknown')));
});

test('ad chest and pet paradise reward strings resolve against the native reward IDs', () => {
  const native = load('native-reward-types').values;
  const chests = report.rewardReferences.filter(r => r.table === 'AdChestInfo');
  assert.ok(chests.length > 0);
  assert.ok(chests.every(r => r.entries.every(e => Object.hasOwn(native, e.type))));
  assert.ok(report.referenceCounts['AdChestInfo.RewardCategoryTier -> native RewardID'] === 83);
  const paradise = report.rewardReferences.filter(r => r.table === 'PetParadiseLevelInfo');
  assert.equal(paradise.length, 2011);
  assert.ok(paradise.some(r => r.entries.some(e => e.type === 'Avatar' && e.target === 'AvatarInfo')));
  assert.ok(paradise.every(r => r.activation === 'unverified' && r.runtimeEnabled === false));
  // A reward tier written with a space still parses, because the source keeps that spacing.
  assert.ok(catalogs.AdChestInfo.records.some(r => r.values.RewardTier.includes(': ')));
});

test('pet paradise boards stay internally consistent and bad rows are reported', () => {
  for (const row of catalogs.PetParadiseLevelInfo.records) {
    assert.equal(Number(row.values.Rows) * Number(row.values.Columns), Number(row.values.BoardSize), row.id);
    assert.ok(Number(row.values.NumberOfFoodTypesToPrefer) <= Number(row.values.NumberOfFoodTypesToSpawn), row.id);
  }
  const broken = structuredClone(catalogs);
  broken.PetParadiseLevelInfo.records[0].values.BoardSize = '99';
  assert.ok(auditCatalogs(broken).errors.some(e => /board size does not match/.test(e)));
  const chance = structuredClone(catalogs);
  chance.AdChestInfo.records[0].values.ChanceTier = '2';
  assert.ok(auditCatalogs(chance).errors.some(e => /ChanceTier: invalid probability/.test(e)));
});

test('the new prize sheet is diffed against the tournament sheet it duplicates', () => {
  const [variant] = report.sourceVariants.filter(entry => entry.table === 'NewPrizeInfoDoc');
  assert.equal(variant.baseTable, 'TournamentRewardInfo');
  assert.equal(variant.records, 273);
  assert.equal(variant.baseRecords, 273);
  assert.deepEqual(variant.added, []);
  assert.deepEqual(variant.removed, []);
  assert.equal(variant.identicalToBase, false);
  assert.deepEqual(variant.variantOnlyColumns, ['Perk']);
  assert.deepEqual(variant.baseOnlyColumns, ['AnniversaryMinigameCurrency', 'PerkTicket', 'Rewards']);
  assert.ok(variant.changed.length > 0);
  assert.equal(variant.liveSelection, 'unknown');
});

test('shop payload files are indexed as server-response samples, not as gameplay tables', () => {
  const samples = load('shop-payload-samples').samples;
  assert.equal(samples.length, 4);
  assert.ok(samples.every(entry => entry.role === 'shop-server-response-sample' && entry.runtimeEnabled === false));
  const byName = Object.fromEntries(samples.map(entry => [entry.name, entry]));
  // One of the bundled files is not even strict JSON, so it is recorded as such instead of being parsed.
  assert.match(byName.ShopInfo.status, /^not-strict-json/);
  assert.equal(byName.ShopInfo.topLevelSections, null);
  for (const name of ['ShopInfoServerTest', 'ShopInfoServerTest_all_dailyDeals', 'ShopInfoServerTest_copy']) {
    assert.equal(byName[name].status, 'strict-json');
    assert.deepEqual(byName[name].topLevelSections,
      ['section_chests', 'section_daily_deals', 'section_special_bundle']);
  }
  assert.ok(byName.ShopInfoServerTest.productTypes.includes('daily_deal'));
  // A daily deal sample is still not a delivery schedule, so the shop bundle gap stays open.
  const deferred = report.deferredReferences.filter(r => r.field === 'DailyDeliveryID');
  assert.equal(deferred.length, 3);
  const manifestTables = load('manifest').tables.map(entry => entry.table);
  for (const name of samples.map(entry => entry.name)) assert.ok(!manifestTables.includes(name), name);
});
