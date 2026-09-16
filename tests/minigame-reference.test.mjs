import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditCatalogs, loadCatalogs, referenceRoot } from '../tools/reference-validation.mjs';
import { parseRewardReference } from '../tools/reward-reference.mjs';
const catalogs = loadCatalogs();
const report = auditCatalogs(catalogs);
const load = name => JSON.parse(readFileSync(new URL(name + '.json', referenceRoot), 'utf8'));
const native = load('native-reward-types').values;

test('minigame and anniversary tables import with their own keys and stay unscheduled', () => {
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.unresolved, []);
  for (const [table, rows, key] of [['MinigameDigsiteLevelInfo', 1000, 'BoardNumber'],
    ['MinigameFishingDerbyFishInfo', 50, 'FishID'], ['MinigameHuntingBeastInfo', 50, 'BeastID'],
    ['MinigameDigsiteTrinketInfo', 43, 'TrinketID'], ['MinigameEventQuestInfo', 15, 'QuestID'],
    ['MinigameClanVaultContributionRewards', 41, 'RewardID'], ['MinigameMazeRewardInfo', 4, 'StartRank'],
    ['AnniversaryTournamentRankRewardInfo', 5, 'StartRank'], ['MinigameHuntingUpgradeInfo', 8, 'HuntUpgradeID'],
    ['MinigameFishingDerbyXPInfo', 5, 'FishingDerbyRarity']]) {
    assert.equal(catalogs[table].records.length, rows, table);
    assert.deepEqual(catalogs[table].keys, [key], table);
    // A sheet paying event currency keeps the more specific mixed-event-rewards scope.
    assert.ok(report.classifications[table].every(r => ['event-minigame', 'mixed-event-rewards'].includes(r.scope)
      && r.evidence.includes('live-event-schedule=unknown')), table);
  }
  // Leaderboard captions and sheet notes are labels, so they never enter the catalog.
  assert.ok(catalogs.MinigameMazeRewardInfo.omittedColumns.includes('LeaderboardPosition'));
  assert.ok(catalogs.MinigameBallDropUpgradeInfo.omittedColumns.includes('Note'));
});

test('minigame upgrade bonus columns are real bonus IDs, not upgrade labels', () => {
  for (const table of ['MinigameBallDropUpgradeInfo', 'MinigameFishingDerbyUpgradeInfo', 'MinigameHuntingUpgradeInfo']) {
    const link = `${table}.BonusType -> BonusInfo`;
    assert.equal(report.referenceCounts[link], catalogs[table].records.length, table);
    for (const row of catalogs[table].records) {
      assert.ok(catalogs.BonusInfo.records.some(bonus => bonus.id === row.values.BonusType),
        `${table}/${row.id}: ${row.values.BonusType}`);
    }
  }
});

test('minigame rewards use the native RewardID grammar, including the bonus reward form', () => {
  const rewards = report.rewardReferences.filter(r => /^(Minigame|AnniversaryTournament)/.test(r.table));
  assert.equal(rewards.length, 1334);
  assert.ok(rewards.every(r => r.entries.every(e => Object.hasOwn(native, e.type))));
  assert.ok(rewards.every(r => r.activation === 'unverified' && r.runtimeEnabled === false));
  const bonusRewards = rewards.flatMap(r => r.entries).filter(e => e.type === 'RewardedBonus');
  assert.equal(bonusRewards.length, 50);
  for (const entry of bonusRewards) {
    assert.equal(entry.target, 'BonusInfo');
    assert.equal(entry.quantity, null);
    assert.ok(catalogs.BonusInfo.records.some(bonus => bonus.id === entry.itemId), entry.itemId);
  }
  const parsed = parseRewardReference('RewardedBonus:AuraLevel:0.01', 'CompletionRewardString', catalogs, native);
  // The amount is fractional, so it is kept as an amount and never as an item count.
  assert.equal(parsed.entries[0].amount, '0.01');
  assert.equal(parsed.entries[0].quantity, null);
  assert.throws(() => parseRewardReference('RewardedBonus:AuraLevel:abc', 'CompletionRewardString', catalogs, native),
    /unsupported reward token/);
  assert.throws(() => parseRewardReference('RewardedBonus:NotABonus:0.5', 'CompletionRewardString', catalogs, native),
    /unknown BonusInfo ID/);
});

test('event quest tiers pair requirements with rewards instead of parsing a reward string', () => {
  for (const row of catalogs.MinigameEventQuestInfo.records) {
    const requirements = row.values.Requirement.split(',');
    const rewards = row.values.Reward.split(',');
    assert.equal(requirements.length, rewards.length, row.id);
    assert.ok(requirements.length > 0, row.id);
  }
  // The quest sheet's Reward column is a plain number list, so it is not in the reward references.
  assert.ok(!report.rewardReferences.some(r => r.table === 'MinigameEventQuestInfo'));
  const broken = structuredClone(catalogs);
  broken.MinigameEventQuestInfo.records[0].values.Reward = '1';
  assert.ok(auditCatalogs(broken).errors.some(e => /quest tiers mismatch/.test(e)));
});

test('an anniversary avatar the package does not contain is deferred, not invented', () => {
  const missing = report.deferredReferences.filter(r => r.target === 'AvatarInfo');
  assert.equal(missing.length, 10);
  const anniversary = missing.filter(r => r.table === 'AnniversaryTournamentRankRewardInfo');
  assert.equal(anniversary.length, 2);
  assert.ok(anniversary.every(r => r.value === 'AvatarAnniversary10'));
  const enumIds = load('native-cosmetic-types').types.AvatarID;
  assert.ok(!Object.hasOwn(enumIds, 'AvatarAnniversary10'));
  assert.ok(!catalogs.AvatarInfo.records.some(r => r.id === 'AvatarAnniversary10'));
  // The other cosmetics in the same reward row do exist and are still resolved.
  const row = report.rewardReferences.find(r => r.table === 'AnniversaryTournamentRankRewardInfo');
  assert.ok(row.entries.some(e => e.type === 'Title' && e.target === 'PlayerTitleInfo' && !e.targetMissing));
});
