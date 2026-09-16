import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCatalogs, loadCatalogs, loadNativeFairyRewards } from '../tools/reference-validation.mjs';
const catalogs = loadCatalogs();
const report = auditCatalogs(catalogs);

test('remaining gameplay support tables import with their own keys', () => {
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.unresolved, []);
  for (const [table, rows, keys] of [['BackgroundInfo', 70, ['Level']], ['BackgroundCycleInfo', 48, ['Level']],
    ['BuildGuideInfo', 9, ['GuideID']], ['FairyRewardTableInfo', 256, ['RewardIndex']],
    ['PanelVariantInfo', 4, ['TestGroup']], ['QTEInfo', 9, ['QTEType']],
    ['SeasonRankingsInfo', 5, ['PositionID']], ['StickerInfo', 27, ['StickerID']],
    ['SummonLevelTitanCardRateInfo', 1000, ['Level']], ['SupportInfo', 11, ['Description']],
    ['TitanSummonBannerInfo', 7, ['BannerID']], ['TitanSummonLevelCost', 3000, ['Level']],
    ['TutorialEventInfo', 51, ['TutorialEventIndex']], ['VideoFairySpawnInfo', 56, ['FairyID', 'MinStage']]]) {
    assert.equal(catalogs[table].records.length, rows, table);
    assert.deepEqual(catalogs[table].keys, keys, table);
    assert.equal(new Set(catalogs[table].records.map(r => r.id)).size, rows, table);
  }
  // The sticker image column is artwork, so it is omitted like other image columns.
  assert.ok(catalogs.StickerInfo.omittedColumns.includes('StickerImage'));
});

test('a key column is kept even when its name matches an omitted text column', () => {
  const support = catalogs.SupportInfo;
  // SupportInfo is keyed by Description, which is normally an omitted text column.
  assert.deepEqual(support.keys, ['Description']);
  assert.ok(Object.hasOwn(support.schema, 'Description'));
  assert.deepEqual(support.omittedColumns, []);
  for (const row of support.records) {
    assert.equal(row.id, row.values.Description);
    assert.ok(row.values.LocalizationID.startsWith('SUPPORT_'));
  }
  // Other tables still omit Description when it is not their key.
  assert.ok(catalogs.SeasonRankingsInfo.omittedColumns.includes('Description'));
  assert.ok(!Object.hasOwn(catalogs.SeasonRankingsInfo.schema, 'Description'));
});

test('support tables resolve into the catalogs and native enums they name', () => {
  const counts = report.referenceCounts;
  // The Fairy row has no talent, so only eight of the nine QTE rows link to a talent.
  assert.equal(counts['QTEInfo.TalentID -> SkillTreeInfo2.0'], 8);
  assert.equal(counts['QTEInfo.CooldownBonusType -> BonusInfo'], 9);
  assert.equal(catalogs.QTEInfo.records.filter(r => r.values.TalentID === '').length, 1);
  assert.ok(counts['BuildGuideInfo.EquipmentCollection -> C_EquipmentInfo'] > 100);
  assert.ok(counts['BuildGuideInfo.ArtifactIDCollection -> ArtifactInfo'] > 40);
  assert.equal(counts['SeasonRankingsInfo.RankBonuses -> BonusInfo'], 14);
  assert.equal(counts['SeasonRankingsInfo.RankTitle -> PlayerTitleInfo'], 4);
  assert.equal(counts['TitanSummonBannerInfo.BoostCardsOfType -> TitanCardInfo.SubType'], 7);
  assert.equal(counts['VideoFairySpawnInfo.FairyID -> native FairyReward'], 56);
  const fairies = loadNativeFairyRewards();
  assert.equal(Object.keys(fairies).length, 24);
  for (const row of catalogs.VideoFairySpawnInfo.records) {
    assert.ok(Object.hasOwn(fairies, row.values.FairyID), row.values.FairyID);
    assert.ok(Number(row.values.MinStage) <= Number(row.values.MaxStage), row.id);
  }
  // A banner may boost one card subtype, or Random for none in particular.
  const subtypes = new Set(catalogs.TitanCardInfo.records.map(r => r.values.SubType));
  for (const row of catalogs.TitanSummonBannerInfo.records) {
    assert.ok(row.values.BoostCardsOfType === 'Random' || subtypes.has(row.values.BoostCardsOfType), row.id);
  }
});

test('broken support rows are reported instead of being accepted', () => {
  const cases = [
    ['VideoFairySpawnInfo', 'FairyID', 'VideoAdsNothing', /native FairyReward/, 'unresolved'],
    ['TutorialEventInfo', 'Objective', 'DanceCount:5', /unsupported tutorial objective/, 'errors'],
    ['SeasonRankingsInfo', 'RankBonuses', 'NotABonus:1', /BonusInfo/, 'unresolved'],
    ['TitanSummonBannerInfo', 'BoostCardsOfType', 'Bard', /TitanCardInfo.SubType/, 'unresolved'],
  ];
  for (const [table, field, value, expected, bucket] of cases) {
    const broken = structuredClone(catalogs);
    const row = broken[table].records[0];
    row.values[field] = value;
    if (broken[table].keys.includes(field)) row.id = value;
    const result = auditCatalogs(broken);
    const hit = bucket === 'errors'
      ? result.errors.some(e => expected.test(e))
      : result.unresolved.some(r => expected.test(r.target) && r.value === value.split(':')[0]);
    assert.ok(hit, `${table}.${field}`);
  }
});

test('the two tutorial variants are diffed against the base tutorial sheet', () => {
  const variants = Object.fromEntries(report.sourceVariants.map(entry => [entry.table, entry]));
  assert.equal(variants.TutorialEventInfo_A.baseTable, 'TutorialEventInfo');
  assert.equal(variants.TutorialEventInfo_B.baseTable, 'TutorialEventInfo');
  assert.deepEqual(variants.TutorialEventInfo_A.added, []);
  assert.deepEqual(variants.TutorialEventInfo_A.removed, []);
  assert.equal(variants.TutorialEventInfo_A.changed.length, 27);
  // Variant B matches the base sheet exactly, which is a fact worth keeping rather than deduplicating.
  assert.equal(variants.TutorialEventInfo_B.identicalToBase, true);
  assert.ok(variants.TutorialEventInfo_A.liveSelection === 'unknown');
  assert.equal(catalogs.TutorialEventInfo_A.records.length, 51);
  assert.equal(catalogs.TutorialEventInfo_B.records.length, 51);
});
