import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditCatalogs, loadCatalogs, referenceRoot } from '../tools/reference-validation.mjs';
import { REWARD_FIELDS } from '../tools/sheet-reward-reference.mjs';
const catalogs = loadCatalogs();
const report = auditCatalogs(catalogs);
const load = name => JSON.parse(readFileSync(new URL(name + '.json', referenceRoot), 'utf8'));
const native = load('native-reward-types').values;

test('holiday and global event tables import with the composite keys their phases need', () => {
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.unresolved, []);
  for (const [table, rows, keys] of [['GlobalEventInfo', 1, ['EventId']],
    ['GlobalEventTasksInfo', 3, ['TaskName']], ['HolidayEventCurrencyAmounts', 8, ['RewardType']],
    ['HolidayEventBombGameLevelInfo', 1300, ['BoardNumber']],
    ['HolidayEventBombGameRewardInfo', 3, ['StartRank']],
    ['HolidayEventGlobalRaidLevelInfo', 45, ['HolidayEventID', 'Phase']],
    ['HolidayEventGlobalRaidRewardInfo', 45, ['HolidayEventID', 'Phase']],
    ['HolidayEventGlobalRaidPartDestroyOrder', 16, ['Part']],
    ['HolidayEventGlobalRaidSoloContributionRewards', 101, ['HolidayEventGlobalRaidSoloContributionRewardIndex']],
    ['HolidayEventGlobalRaidTargetZoneInfo', 1199, ['AttackNumber', 'Time', 'TargetPartID']]]) {
    assert.equal(catalogs[table].records.length, rows, table);
    assert.deepEqual(catalogs[table].keys, keys, table);
    assert.equal(new Set(catalogs[table].records.map(r => r.id)).size, rows, table);
  }
  // Attack number and time alone repeat, so the targeted part is part of the key.
  const zones = catalogs.HolidayEventGlobalRaidTargetZoneInfo.records;
  assert.ok(new Set(zones.map(r => `${r.values.AttackNumber}|${r.values.Time}`)).size < zones.length);
  // The global raid reward sheet keeps a multi-line note out of the catalog.
  assert.ok(catalogs.HolidayEventGlobalRaidRewardInfo.omittedColumns.includes('Note'));
});

test('global raid areas, enemies and destroy order resolve against the raid catalogs', () => {
  assert.ok(report.referenceCounts['HolidayEventGlobalRaidLevelInfo.AreaID -> RaidAreaInfo'] > 45);
  assert.ok(report.referenceCounts['HolidayEventGlobalRaidLevelInfo.EnemyIDs -> RaidEnemyInfo'] > 45);
  assert.equal(report.referenceCounts['HolidayEventGlobalRaidPartDestroyOrder.Part -> RaidEnemyPartInfo'], 16);
  for (const row of catalogs.HolidayEventGlobalRaidPartDestroyOrder.records) {
    const fraction = Number(row.values.DestroyedOn);
    assert.ok(fraction >= 0 && fraction <= 1, row.id);
  }
  assert.equal(report.referenceCounts['GlobalEventInfo.TaskNames -> GlobalEventTasksInfo'], 3);
  const broken = structuredClone(catalogs);
  broken.HolidayEventGlobalRaidLevelInfo.records[0].values.AreaID = 'Area1,AreaNine';
  assert.ok(auditCatalogs(broken).unresolved.some(r => r.value === 'AreaNine' && r.target === 'RaidAreaInfo'));
});

test('the holiday global raid boss has its own part names, separate from the raid part catalog', () => {
  const parts = report.holidayRaidParts;
  assert.equal(parts.field, 'TargetPartID');
  assert.deepEqual(parts.parts, ['Chest', 'Head', 'LeftArm', 'LeftFinger', 'LeftLeg',
    'RightArm', 'RightFinger', 'RightLeg']);
  // None of them is a RaidEnemyPartInfo ID, so they are recorded rather than forced into that catalog.
  assert.deepEqual(parts.inRaidPartCatalog, []);
  for (const part of parts.parts) {
    assert.ok(!catalogs.RaidEnemyPartInfo.records.some(r => r.id === part), part);
  }
  // The destroy order sheet, by contrast, does use the raid part IDs.
  assert.ok(catalogs.HolidayEventGlobalRaidPartDestroyOrder.records
    .every(r => catalogs.RaidEnemyPartInfo.records.some(part => part.id === r.id)));
});

test('holiday event rewards split between the native grammar and the sheet vocabulary', () => {
  const nativeParsed = report.rewardReferences.filter(r => r.table.startsWith('HolidayEvent'));
  assert.equal(nativeParsed.length, 149);
  assert.ok(nativeParsed.every(r => r.entries.every(e => Object.hasOwn(native, e.type))));
  // The bomb game level sheet names FortuneHelperWeapon, so it goes through the sheet vocabulary instead.
  assert.deepEqual(REWARD_FIELDS.HolidayEventBombGameLevelInfo, ['RewardString']);
  assert.ok(!nativeParsed.some(r => r.table === 'HolidayEventBombGameLevelInfo'));
  const vocabulary = Object.fromEntries(report.sheetRewardVocabulary.map(e => [e.type, e]));
  assert.equal(report.sheetRewardVocabulary.length, 17);
  assert.deepEqual(Object.values(vocabulary).filter(e => e.nativeRewardId === null).map(e => e.type).sort(),
    ['FortuneHelperWeapon', 'RandomLevelPet']);
  assert.ok(vocabulary.FortuneHelperWeapon.tables.includes('HolidayEventBombGameLevelInfo'));
  assert.equal(vocabulary.FortuneHelperWeapon.uses, 494);
  // Perk and HelperWeapon are real reward IDs and stay on the native path.
  assert.ok(nativeParsed.some(r => r.entries.some(e => e.type === 'Perk')));
  assert.ok(nativeParsed.some(r => r.entries.some(e => e.type === 'HelperWeapon')));
});
