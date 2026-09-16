import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditCatalogs, loadCatalogs, referenceRoot } from '../tools/reference-validation.mjs';
import { REWARD_FIELDS, compareRewardColumns, parseSheetRewardList } from '../tools/sheet-reward-reference.mjs';
const catalogs = loadCatalogs();
const report = auditCatalogs(catalogs);
const load = name => JSON.parse(readFileSync(new URL(name + '.json', referenceRoot), 'utf8'));
const native = load('native-reward-types').values;

test('tournament reward tables import with the composite keys their rank rows need', () => {
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.unresolved, []);
  for (const [table, rows, keys] of [
    ['TournamentRewardInfo', 273, ['PrizeID', 'TierID', 'StartRank', 'PrizeType']],
    ['SuperTournamentRewardInfo', 297, ['PrizeID', 'TierID', 'StartRank', 'PrizeType']],
    ['NewPlayerTournamentRewardInfo', 5, ['StartRank']],
    ['ChallengeTournamentRewardInfo', 30, ['StartRank', 'PrizeType']],
    ['SuperChallengeTournamentRewardInfo', 30, ['StartRank', 'PrizeType']],
    ['ChallengeTournamentProgressionRewardInfo', 196, ['TourneyID', 'RewardStage']],
    ['ChallengeTournamentArtifactPools', 103, ['ArtifactID']]]) {
    assert.equal(catalogs[table].records.length, rows, table);
    assert.deepEqual(catalogs[table].keys, keys, table);
    assert.equal(new Set(catalogs[table].records.map(r => r.id)).size, rows, table);
    assert.ok(report.classifications[table].every(r => r.liveAvailability === 'unknown'), table);
  }
  // StartRank alone repeats across prize types, so it cannot be the stable key on its own.
  const starts = catalogs.TournamentRewardInfo.records.map(r => r.values.StartRank);
  assert.ok(new Set(starts).size < starts.length);
});

test('two tournament reward tokens have no native RewardID and are recorded, not renamed', () => {
  const vocabulary = Object.fromEntries(report.sheetRewardVocabulary.map(entry => [entry.type, entry]));
  assert.equal(vocabulary.FortuneHelperWeapon.nativeRewardId, null);
  assert.equal(vocabulary.RandomLevelPet.nativeRewardId, null);
  // The tournament sheets account for 485 of the FortuneHelperWeapon uses; the bomb game adds the rest.
  assert.equal(vocabulary.FortuneHelperWeapon.tables.filter(t => /Tournament/.test(t)).length, 3);
  assert.equal(vocabulary.RandomLevelPet.uses, 96);
  for (const entry of report.sheetRewardVocabulary) {
    if (entry.nativeRewardId === null) continue;
    assert.equal(entry.nativeRewardId, native[entry.type], entry.type);
  }
  assert.ok(report.sheetRewards.every(row =>
    row.interpretation === 'sheet-token-list-not-native-reward-grammar'
    && row.deliveryRules === 'unverified' && row.runtimeEnabled === false));
  // The sheet vocabulary is deliberately not routed through the RewardID grammar.
  assert.ok(!report.rewardReferences.some(row => Object.hasOwn(REWARD_FIELDS, row.table)));
});

test('the reward string repeats the amount columns everywhere except the super tournament sheet', () => {
  const agreement = Object.fromEntries(report.sheetColumnAgreement.map(entry => [entry.table, entry]));
  for (const table of ['TournamentRewardInfo', 'ChallengeTournamentRewardInfo', 'SuperChallengeTournamentRewardInfo']) {
    assert.equal(agreement[table].divergedRows, 0, table);
    assert.deepEqual(agreement[table].divergedColumns, {}, table);
    assert.ok(agreement[table].agreed > 0, table);
  }
  const superTournament = agreement.SuperTournamentRewardInfo;
  assert.equal(superTournament.rows, 297);
  assert.equal(superTournament.divergedRows, 198);
  assert.deepEqual(superTournament.divergedColumns, { Perk: 99, PremiumWeapon: 198 });
  // Neither side of that disagreement is treated as the correct one.
  const row = catalogs.SuperTournamentRewardInfo.records.find(r => /PerkTicket:/.test(r.values.Rewards));
  const comparison = compareRewardColumns('SuperTournamentRewardInfo', row, native);
  assert.ok(comparison.diverged.some(item => item.column === 'Perk' && item.token !== item.cell));
  assert.ok(row.values.Rewards.includes('PerkTicket:'));
});

test('tournament reward tokens keep their source text and reject shapes the sheets never use', () => {
  const parsed = parseSheetRewardList('Diamonds:1200,RandomLevelPet:16,Equipment:Rare:3', native);
  assert.deepEqual(parsed.map(e => [e.type, e.quantity, e.itemId, e.qualifier ?? null, e.nativeRewardId]),
    [['Diamonds', '1200', null, null, '33'], ['RandomLevelPet', '16', null, null, null],
     ['Equipment', '3', null, 'Rare', '15']]);
  assert.deepEqual(parseSheetRewardList('', native), []);
  assert.deepEqual(parseSheetRewardList('None', native), []);
  for (const bad of ['Diamonds', 'Diamonds:1:2:3', ':5', 'Equipment:Mythic:3']) {
    assert.throws(() => parseSheetRewardList(bad, native), /tournament reward token/, bad);
  }
  assert.throws(() => parseSheetRewardList(null, native), /must be a string/);
});

test('challenge tournament artifact pools keep weights, including artifacts weighted out of every pool', () => {
  const pools = Object.fromEntries(report.challengeArtifactPools.map(entry => [entry.pool, entry]));
  assert.deepEqual(Object.keys(pools).sort(), ['A', 'B', 'C', 'D', 'E', 'none']);
  for (const pool of ['A', 'B', 'C', 'D', 'E']) {
    assert.equal(pools[pool].artifacts, 103);
    assert.ok(pools[pool].weighted > 0 && pools[pool].weighted <= 103);
  }
  assert.deepEqual(pools.none.excluded, ['Artifact20', 'Artifact29', 'Artifact35']);
  assert.equal(pools.none.weighted, 3);
  assert.ok(report.challengeArtifactPools.every(entry => entry.activation === 'unverified'));
  assert.ok(report.referenceCounts['ChallengeTournamentArtifactPools.ArtifactID -> ArtifactInfo'] === 103);
  const broken = structuredClone(catalogs);
  broken.ChallengeTournamentArtifactPools.records[0].values.A = 'high';
  assert.ok(auditCatalogs(broken).errors.some(e => /invalid pool weight/.test(e)));
});
