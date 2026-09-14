import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditCatalogs, loadCatalogs, referenceRoot } from '../tools/reference-validation.mjs';
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
