import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TT2_DAILY } from '../lib/tt2-data.ts';
import { referenceRoot } from '../tools/reference-validation.mjs';
const load = name => JSON.parse(readFileSync(new URL(name + '.json', referenceRoot), 'utf8'));
const rows = load('DailyRewardsInfo').records;
const evidence = load('daily-rewards-parser-evidence');

const TYPES = { MONSTER_GOLD: 'MonsterGold', DIAMONDS: 'Diamonds', EQUIPMENT: 'Equipment', EGG: 'Pet',
  PERK: 'Perk', HELPER_WEAPON: 'HelperWeapon', MAKE_IT_RAIN: 'MakeItRain', SKILL_POINT: 'SkillPoint',
  CHEST_TOKEN: 'ChestToken', EQUIPMENT_SHARDS: 'EquipmentShards', SKILL_RESET_TOKEN: 'SkillResetToken' };

test('the client reads Count, not the Reward string, so Count is the amount to use', () => {
  assert.deepEqual(evidence.columnsRead,
    ['Day', 'RewardType', 'Count', 'HolidayCurrency', 'AnniversaryMinigameCurrency']);
  assert.deepEqual(evidence.columnsIgnored, ['Reward']);
  assert.equal(evidence.evidence.amountColumn, 'Count');
  assert.equal(evidence.evidence.cellsPerRow, 5);
  assert.match(evidence.evidence.consequence, /Count is the amount the client uses/);
  // The native struct has no field for a reward string, which is why the column is unread.
  assert.deepEqual(evidence.evidence.structFields,
    ['type', 'amount', 'dayNumber', 'holidayCurrency', 'anniversaryMinigameCurrency']);
  assert.equal(evidence.table, 'DailyRewardsInfo');
});

test('all fourteen daily rewards match the columns the client reads', () => {
  assert.equal(TT2_DAILY.length, 14);
  assert.equal(rows.length, 14);
  for (const row of rows) {
    const day = Number(row.values.Day);
    const ours = TT2_DAILY.find(entry => entry.day === day);
    assert.ok(ours, `第 ${day} 天`);
    assert.equal(ours.reward, TYPES[row.values.RewardType] ?? row.values.RewardType, `第 ${day} 天類型`);
    assert.equal(String(ours.amount), row.values.Count, `第 ${day} 天數量`);
    assert.equal(String(ours.event), row.values.HolidayCurrency, `第 ${day} 天活動貨幣`);
  }
});

test('the sheet disagrees with itself on three days, and Count is the side we follow', () => {
  const disagreeing = rows.filter(row => {
    const main = row.values.Reward.split(',').map(token => token.split(':'))
      .find(([type]) => !['HolidayCurrency', 'AnniversaryMinigameCurrency'].includes(type));
    return main && main[1] !== row.values.Count;
  }).map(row => Number(row.values.Day));
  assert.deepEqual(disagreeing.sort((a, b) => a - b), [1, 5, 11]);
  // Day one is the case that changed: the Reward string says 1000, the Count column says 100.
  const first = rows.find(row => row.values.Day === '1');
  assert.equal(first.values.Count, '100');
  assert.match(first.values.Reward, /MonsterGold:1000/);
  assert.equal(TT2_DAILY[0].amount, 100);
});
