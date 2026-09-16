import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditCatalogs, loadCatalogs, loadNativeCosmetics, referenceRoot } from '../tools/reference-validation.mjs';
import { parseRewardReference } from '../tools/reward-reference.mjs';
const catalogs = loadCatalogs();
const native = JSON.parse(readFileSync(new URL('native-reward-types.json', referenceRoot), 'utf8')).values;

test('cosmetic rank rewards retain ID values and do not infer numeric quantities', () => {
  assert.equal(catalogs.AvatarInfo.records.length, 583);
  assert.equal(catalogs.AvatarFrameInfo.records.length, 65);
  assert.equal(catalogs.PlayerTitleInfo.records.length, 263);
  const rewards = parseRewardReference('Avatar:AvatarEndgameSeason12Rank1,Frame:FrameEndgameSeason12,Title:634',
    'RankReward', catalogs, native);
  assert.deepEqual(rewards.entries.map(e => e.target), ['AvatarInfo', 'AvatarFrameInfo', 'PlayerTitleInfo']);
  assert.ok(rewards.entries.every(e => e.quantity === null && e.nativeItemId === ''));
  assert.equal(rewards.entries[2].nativeValue, '634');
  assert.equal(rewards.entries[2].itemId, '634');
});

test('rank source variants remain separate and missing cosmetics fail without auto-awarding another title', () => {
  const report = auditCatalogs(catalogs);
  assert.deepEqual(report.errors, []);
  const ranks = report.rewardReferences.filter(r => r.field === 'RankReward');
  assert.equal(ranks.length, 8);
  assert.deepEqual([...new Set(ranks.map(r => r.season))].sort(), ['12', '13']);
  assert.ok(ranks.every(r => r.activation === 'unverified' && r.runtimeEnabled === false));
  assert.ok(catalogs.PlayerTitleInfo.records.some(r => r.id === '633'));
  assert.ok(!ranks.some(r => r.entries.some(e => e.type === 'Title' && e.itemId === '633')));
  for (const [table, id] of [['AvatarInfo', 'AvatarEndgameSeason12Rank1'], ['AvatarFrameInfo', 'FrameEndgameSeason12'], ['PlayerTitleInfo', '634']]) {
    const broken = structuredClone(catalogs);
    broken[table].records = broken[table].records.filter(r => r.id !== id);
    assert.ok(auditCatalogs(broken).errors.some(e => e.includes(`unknown ${table} ID: ${id}`)));
  }
});

test('cosmetic support catalogs stay inside their native enums and keep unclaimed members listed', () => {
  assert.equal(catalogs.AvatarParticleInfo.records.length, 22);
  assert.equal(catalogs.ProfileBackgroundInfo.records.length, 47);
  const report = auditCatalogs(catalogs);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.unresolved, []);
  const coverage = Object.fromEntries(report.cosmeticCoverage.map(entry => [entry.table, entry]));
  assert.deepEqual(Object.keys(coverage).sort(),
    ['AvatarFrameInfo', 'AvatarInfo', 'AvatarParticleInfo', 'PlayerTitleInfo', 'ProfileBackgroundInfo']);
  assert.ok(report.cosmeticCoverage.every(entry => entry.activation === 'unverified' && entry.runtimeEnabled === false));
  assert.deepEqual(coverage.AvatarParticleInfo.enumOnly, ['None', 'Particle1']);
  assert.deepEqual(coverage.AvatarFrameInfo.enumOnly, ['None']);
  assert.equal(coverage.AvatarInfo.enumOnly.length, 25);
  for (const entry of report.cosmeticCoverage) {
    const present = new Set(catalogs[entry.table].records.map(row => row.id));
    assert.ok(entry.enumOnly.every(member => !present.has(member)));
  }
  const native = loadNativeCosmetics();
  for (const table of ['AvatarInfo', 'AvatarFrameInfo', 'AvatarParticleInfo', 'PlayerTitleInfo']) {
    assert.ok(Object.keys(coverage[table].unlockTypes).every(type => Object.hasOwn(native.types.AvatarUnlockType, type)));
  }
  assert.deepEqual(coverage.AvatarParticleInfo.unlockTypes, { ChallengeTournamentShop: 21, Milestones: 1 });
  assert.deepEqual(coverage.ProfileBackgroundInfo.categories, { Player: 14, Raid: 33 });
  assert.equal(coverage.ProfileBackgroundInfo.unlockTypes, null);
  assert.equal(coverage.ProfileBackgroundInfo.idType, null);
});

test('cosmetic IDs, unlock types and background slots outside the native enums are reported', () => {
  for (const [table, field, value, target] of [
    ['AvatarParticleInfo', 'AvatarParticleID', 'AvatarParticleAbyss99', 'AvatarParticleID'],
    ['AvatarParticleInfo', 'UnlockType', 'FutureTournamentShop', 'AvatarUnlockType'],
    ['AvatarFrameInfo', 'AvatarFrameID', 'FrameAbyss99', 'AvatarFrameId'],
    ['PlayerTitleInfo', 'TitleUnlockType', 'FutureUnlock', 'AvatarUnlockType'],
    ['ProfileBackgroundInfo', 'ProfileBackgroundType', 'Clan', 'ProfileBackgroundType'],
  ]) {
    const broken = structuredClone(catalogs);
    const row = broken[table].records[0];
    row.values[field] = value;
    if (broken[table].keys.includes(field)) row.id = value;
    assert.ok(auditCatalogs(broken).unresolved.some(issue =>
      issue.table === table && issue.field === field && issue.value === value && issue.target === target));
  }
});

test('particles and backgrounds have native reward IDs but no bundled reward grants them yet', () => {
  for (const type of ['AvatarParticle', 'ProfileBackground', 'ProfileBackgroundPlayer', 'ProfileBackgroundRaid']) {
    assert.ok(Object.hasOwn(native, type));
  }
  const report = auditCatalogs(catalogs);
  assert.ok(!report.rewardReferences.some(reference =>
    reference.entries.some(entry => /^(AvatarParticle|ProfileBackground)/.test(entry.type))));
  for (const token of ['AvatarParticle:AvatarParticleAbyss1', 'ProfileBackgroundPlayer:Forest']) {
    assert.throws(() => parseRewardReference(token, 'RewardString', catalogs, native), /unsupported reward token/);
  }
});
