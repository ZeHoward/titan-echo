import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditCatalogs, loadCatalogs, referenceRoot } from '../tools/reference-validation.mjs';
import { parseRewardReference } from '../tools/reward-reference.mjs';
const catalogs = loadCatalogs();
const report = auditCatalogs(catalogs);
const load = name => JSON.parse(readFileSync(new URL(name + '.json', referenceRoot), 'utf8'));
const native = load('native-reward-types').values;

test('raid progression tables import with composite keys and resolved enemy, area and card links', () => {
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.unresolved, []);
  for (const [table, rows, keys] of [['RaidMasterTierLevelInfo', 190, ['TierID', 'LevelID']],
    ['SoloRaidLevelInfo', 1200, ['WorldID', 'LevelID']], ['SoloRaidFarmingLevelInfo', 120, ['WorldID']],
    ['RaidResearchInfo', 94, ['ResearchID']], ['RaidCardLevelRewardInfo', 150, ['CardLevel']],
    ['RaidTicketBoostInfo', 301, ['TicketAmount']], ['RaidLoyaltyInfo', 13, ['TicketsGivenToClan']],
    ['RaidCardBoostedSlotInfo', 14, ['TotalCardLevel']], ['RaidEnemyEnchantmentInfo', 3, ['BonusType']],
    ['RaidFastCompletionBonusStagesInfo', 3, ['RaidDuration']],
    ['RaidMasterTierFastCompletionBonusStagesInfo', 6, ['RaidDuration']]]) {
    assert.equal(catalogs[table].records.length, rows, table);
    assert.deepEqual(catalogs[table].keys, keys, table);
    assert.equal(new Set(catalogs[table].records.map(r => r.id)).size, rows, table);
  }
  // The master tier sheet repeats TierID 9999, so only the composite key is unique.
  assert.ok(catalogs.RaidMasterTierLevelInfo.records.filter(r => r.values.TierID === '9999').length > 1);
  const counts = report.referenceCounts;
  assert.ok(counts['SoloRaidLevelInfo.EnemyIDs -> RaidEnemyInfo'] > 0);
  assert.ok(counts['RaidMasterTierLevelInfo.AreaID -> RaidAreaInfo'] > 0);
  assert.ok(counts['SoloRaidLevelInfo.AvatarReward -> AvatarInfo'] > 0);
  assert.equal(counts['RaidCardLevelRewardInfo.CardLevel -> RaidSkillCardCostInfo'], 150);
});

test('solo raid and master tier rewards parse with the native reward IDs they actually use', () => {
  const fields = report.rewardReferences.filter(r =>
    /^(SoloRaidLevelInfo|SoloRaidFarmingLevelInfo|RaidMasterTierRewardInfo(_1)?)$/.test(r.table));
  assert.ok(fields.length > 0);
  assert.ok(fields.every(r => r.activation === 'unverified' && r.runtimeEnabled === false
    && r.deliveryRules === 'unverified'));
  const types = new Set(fields.flatMap(r => r.entries.map(e => e.type)));
  assert.ok([...types].every(type => Object.hasOwn(native, type)), [...types].join(','));
  assert.ok(types.has('FortuneRaidCard') && types.has('PlayerRaidXP'));
  // Newly supported scalars keep their quantity as source text and name no catalog item.
  const parsed = parseRewardReference('RaidCard:12,RaidWildcard:2,FortuneRaidCard:2', 'Reward', catalogs, native);
  assert.deepEqual(parsed.entries.map(e => [e.type, e.quantity, e.itemId]),
    [['RaidCard', '12', null], ['RaidWildcard', '2', null], ['FortuneRaidCard', '2', null]]);
  assert.throws(() => parseRewardReference('FortuneRaidCard:two', 'Reward', catalogs, native), /unsupported reward token/);
  assert.throws(() => parseRewardReference('RaidCard:1', 'Equiv. HP', catalogs, native), /unsupported reward field/);
});

test('season 17 master tier avatars are recorded as a source gap, never invented', () => {
  const missing = report.deferredReferences.filter(r => r.target === 'AvatarInfo'
    && r.table.startsWith('RaidMasterTierRewardInfo'));
  assert.equal(missing.length, 8);
  assert.deepEqual([...new Set(missing.map(r => r.value))].sort(), ['AvatarClanMasterTierSeason17Top10',
    'AvatarClanMasterTierSeason17Top100', 'AvatarClanMasterTierSeason17Top25', 'AvatarClanMasterTierSeason17Top50']);
  const enumIds = load('native-cosmetic-types').types.AvatarID;
  const catalogIds = new Set(catalogs.AvatarInfo.records.map(r => r.id));
  for (const entry of missing) {
    assert.ok(!Object.hasOwn(enumIds, entry.value));
    assert.ok(!catalogIds.has(entry.value));
    assert.match(entry.reason, /native AvatarID enum/);
  }
  // Titles in the same reward strings do exist, so the rows are still parsed rather than dropped.
  const ranks = report.rewardReferences.filter(r => r.table === 'RaidMasterTierRewardInfo');
  assert.ok(ranks.some(r => r.entries.some(e => e.type === 'Title' && e.itemId === '581')));
  assert.ok(ranks.some(r => r.entries.some(e => e.targetMissing === true)));
});

test('a reward target the package does know stays a hard error', () => {
  const broken = structuredClone(catalogs);
  broken.PlayerTitleInfo.records = broken.PlayerTitleInfo.records.filter(r => r.id !== '581');
  const errors = auditCatalogs(broken).errors;
  assert.ok(errors.some(e => e.includes('unknown PlayerTitleInfo ID: 581')));
});

test('dangling raid research prerequisites are only tolerated on rows that grant nothing', () => {
  const dangling = report.deferredReferences.filter(r => r.table === 'RaidResearchInfo');
  assert.equal(dangling.length, 17);
  assert.ok(dangling.every(r => r.value === '999' && r.field === 'RequiredResearchID'));
  for (const entry of dangling) {
    const row = catalogs.RaidResearchInfo.records.find(r => r.id === entry.id).values;
    assert.deepEqual([row.BonusType, row.MaxLevel, row.ResearchPointsPerLevel], ['None', '0', '0']);
  }
  const broken = structuredClone(catalogs);
  const target = broken.RaidResearchInfo.records.find(r => r.values.RequiredResearchID === '999');
  target.values.MaxLevel = '5';
  assert.ok(auditCatalogs(broken).unresolved.some(r =>
    r.table === 'RaidResearchInfo' && r.value === '999' && r.id === target.id));
});

test('repeated header columns resolve to the last column and keep the shadowed cells', () => {
  const evidence = load('infodoc-parser-evidence');
  assert.equal(evidence.columnPolicy, 'last-header-index-wins');
  for (const table of ['RaidTicketBoostInfo', 'RaidResearchInfo']) {
    const resolution = catalogs[table].columnResolution;
    assert.equal(resolution.policy, evidence.columnPolicy);
    assert.equal(resolution.evidence, 'infodoc-parser-evidence.json');
    for (const column of resolution.repeated) {
      assert.ok(column.sourceIndexes.length > 1, column.column);
      assert.equal(column.effectiveIndex, Math.max(...column.sourceIndexes));
      assert.equal(column.shadowed.length, column.sourceIndexes.length - 1);
      for (const shadow of column.shadowed) {
        assert.ok(column.sourceIndexes.includes(shadow.sourceIndex));
        assert.notEqual(shadow.sourceIndex, column.effectiveIndex);
        assert.equal(shadow.values.length, catalogs[table].records.length);
      }
      // The published column carries the last source column, and the earlier one survives beside it.
      assert.ok(Object.hasOwn(catalogs[table].schema, column.column));
    }
  }
  const research = catalogs.RaidResearchInfo;
  const [totalLevels] = research.columnResolution.repeated;
  assert.equal(totalLevels.column, 'Total Levels');
  assert.equal(research.records[0].values['Total Levels'], '4100');
  assert.equal(totalLevels.shadowed[0].values[0], '10');
});
