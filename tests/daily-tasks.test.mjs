import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apply, advance, fresh, hydrate, TT2_DAILY_TASKS, UNMEASURED_DAILY_TASKS, DAILY_TASK_PAID,
  dailyTaskAvailable, dailyTaskProgress, dailyTaskDone, dailyTaskClaimed } from '../lib/engine.ts';
import { referenceRoot } from '../tools/reference-validation.mjs';

const load = name => JSON.parse(readFileSync(new URL(name + '.json', referenceRoot), 'utf8'));
const rows = load('DailyAchievementInfo').records;
const evidence = load('achievement-parser-evidence');
const index = type => TT2_DAILY_TASKS.findIndex(d => d.type === type);
const at = (s, type, i) => apply(s, { type, index: i, at: s.last });

test('the daily list is the package list, including the row it switches off', () => {
  assert.equal(TT2_DAILY_TASKS.length, 10);
  assert.equal(rows.length, 10);
  for (const row of rows) {
    const ours = TT2_DAILY_TASKS.find(d => d.type === row.values.Type);
    assert.ok(ours, row.values.Type);
    assert.equal(ours.requirement, Number(row.values.Requirement));
    assert.equal(ours.active, row.values.IsActive.trim().toUpperCase() === 'TRUE');
    assert.equal(ours.rewards.map(r => `${r.reward}:${r.amount}`).join(','), row.values.RewardString);
  }
  // UniqueArtifacts is the only row the package itself marks inactive.
  assert.deepEqual(TT2_DAILY_TASKS.filter(d => !d.active).map(d => d.type), ['UniqueArtifacts']);
  assert.deepEqual(evidence.columnsRead.DailyAchievementInfo, ['Type', 'RewardString', 'IsActive', 'Requirement']);
  const native = Object.values(evidence.dailyAchievementTypes);
  for (const d of TT2_DAILY_TASKS) assert.ok(native.includes(d.type), d.type);
});

test('four tasks are measurable and the rest say why they are not', () => {
  const available = TT2_DAILY_TASKS.filter((_, i) => dailyTaskAvailable(i)).map(d => d.type);
  assert.deepEqual(available.sort(), ['ClickFairies', 'CollectedEquipment', 'PetLevels', 'Prestiges']);
  assert.equal(Object.keys(UNMEASURED_DAILY_TASKS).length, 5);
  for (const type of Object.keys(UNMEASURED_DAILY_TASKS)) {
    assert.ok(index(type) >= 0, type);
    assert.ok(UNMEASURED_DAILY_TASKS[type].length > 0, type);
    assert.equal(dailyTaskAvailable(index(type)), false, type);
  }
  // Available plus unmeasurable plus the inactive row is the whole list.
  assert.equal(available.length + Object.keys(UNMEASURED_DAILY_TASKS).length + 1, TT2_DAILY_TASKS.length);
});

test('progress comes from the day\u0027s own events and resets with the day', () => {
  const s = fresh(1000);
  s.best = 60; s.stage = 60;
  const prestige = index('Prestiges');
  assert.equal(dailyTaskProgress(s, prestige), 0);
  const after = apply(s, { type: 'prestige', at: s.last });
  assert.equal(dailyTaskProgress(after, prestige), 1);
  assert.equal(dailyTaskDone(after, prestige), true);
  // The next day starts clean, claimed tasks included.
  at(after, 'dailyTask', prestige);
  assert.equal(dailyTaskClaimed(after, prestige), true);
  advance(after, after.last + 86400000 * 2);
  assert.equal(dailyTaskProgress(after, prestige), 0);
  assert.equal(dailyTaskClaimed(after, prestige), false);
});

test('claiming pays only the currencies this project holds, and only once', () => {
  const s = fresh(1000);
  s.best = 60; s.stage = 60;
  const i = index('Prestiges');
  const task = TT2_DAILY_TASKS[i];
  const done = apply(s, { type: 'prestige', at: s.last });
  const diamonds = done.diamonds, event = done.tt2.eventCurrency;
  at(done, 'dailyTask', i);
  const paid = task.rewards.filter(r => DAILY_TASK_PAID.includes(r.reward));
  assert.equal(done.diamonds, diamonds + paid.find(r => r.reward === 'Diamonds').amount);
  assert.equal(done.tt2.eventCurrency, event + paid.find(r => r.reward === 'HolidayCurrency').amount);
  // The row also lists three currencies that do not exist here; none of them were invented.
  assert.deepEqual(task.rewards.filter(r => !DAILY_TASK_PAID.includes(r.reward)).map(r => r.reward),
    ['RaidTicket', 'Alchemy', 'GemstoneCurrency']);
  at(done, 'dailyTask', i);
  assert.equal(done.diamonds, diamonds + paid.find(r => r.reward === 'Diamonds').amount);
});

test('an unfinished, unavailable or inactive task cannot be claimed', () => {
  const s = fresh(1000);
  s.diamonds = 50;
  for (let i = 0; i < TT2_DAILY_TASKS.length; i++) at(s, 'dailyTask', i);
  assert.equal(s.diamonds, 50);
  assert.deepEqual(s.daily.claimed, []);
  for (const i of [-1, 10, 2.5, NaN]) at(s, 'dailyTask', i);
  assert.equal(s.diamonds, 50);
});

test('a save from before the list existed loads with nothing claimed', () => {
  const legacy = JSON.parse(JSON.stringify(fresh(1000)));
  legacy.daily.claimed = [0, 1, 2];
  delete legacy.daily.petLevels;
  const s = hydrate(legacy);
  assert.deepEqual(s.daily.claimed, []);
  assert.equal(s.daily.petLevels, 0);
  for (let i = 0; i < TT2_DAILY_TASKS.length; i++) assert.equal(dailyTaskClaimed(s, i), false);
});
