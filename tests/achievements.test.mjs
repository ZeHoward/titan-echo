import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apply, fresh, hydrate, achievementProgress, achievementTier, achievementClaimed,
  achievementReward, UNMEASURED_ACHIEVEMENTS, TT2_ACHIEVEMENTS } from '../lib/engine.ts';
import { fromText, toNumber } from '../lib/big-number.ts';
import { referenceRoot } from '../tools/reference-validation.mjs';

const load = name => JSON.parse(readFileSync(new URL(name + '.json', referenceRoot), 'utf8'));
const rows = load('AchievementInfo').records;
const evidence = load('achievement-parser-evidence');
const index = type => TT2_ACHIEVEMENTS.findIndex(a => a.type === type);
const act = (s, type, i) => apply(s, { type, index: i, at: s.last });

test('the table is the package table: same types, tiers and diamond rewards', () => {
  assert.equal(TT2_ACHIEVEMENTS.length, 22);
  assert.equal(rows.length, 22);
  for (const row of rows) {
    const ours = TT2_ACHIEVEMENTS.find(a => a.type === row.values.Type);
    assert.ok(ours, row.values.Type);
    assert.deepEqual(ours.requirement, row.values.Requirement.split(',').map(cell => cell.trim()));
    assert.deepEqual(ours.diamondReward, row.values.Reward.split(',').map(Number));
  }
  // Every type in the table is a member of the native enum, and one member has no row.
  const native = Object.values(evidence.achievementTypes);
  for (const a of TT2_ACHIEVEMENTS) assert.ok(native.includes(a.type), a.type);
  assert.deepEqual(evidence.typesWithoutSheetRow, ['ChestTokens']);
  assert.equal(native.length, 23);
});

test('the reward is diamonds because that is the field the parser fills', () => {
  assert.equal(evidence.evidence.rewardField, 'diamondReward');
  assert.deepEqual(evidence.columnsRead.AchievementInfo, ['Type', 'Requirement', 'Reward']);
  assert.match(evidence.evidence.requirementType, /GHDouble/);
  assert.match(evidence.evidence.rewardType, /List<int>/);
});

test('a requirement past the double range is still a requirement that can be met', () => {
  // CollectGold asks for 1e1500 at the last tier, which only exists as a pair.
  const gold = TT2_ACHIEVEMENTS[index('CollectGold')];
  assert.equal(gold.requirement.at(-1), '1e1500');
  assert.equal(fromText('1e1500').e, 1500);
  assert.equal(toNumber(fromText('1e1500')), Number.MAX_VALUE);
  const s = fresh(1000);
  s.tt2.goldCollected = { s: 1, e: 1500 };
  assert.equal(achievementTier(s, index('CollectGold')), 5);
  assert.equal(achievementReward(s, index('CollectGold')), 5 + 10 + 15 + 25 + 50);
});

test('every achievement is either measured or named as not measurable', () => {
  const s = fresh(1000);
  for (let i = 0; i < TT2_ACHIEVEMENTS.length; i++) {
    const value = achievementProgress(s, i);
    assert.ok(Number.isFinite(value.s) && Number.isFinite(value.e), TT2_ACHIEVEMENTS[i].type);
  }
  assert.deepEqual(Object.keys(UNMEASURED_ACHIEVEMENTS).sort(), ['Manny', 'ParticipatedTournament']);
  for (const type of Object.keys(UNMEASURED_ACHIEVEMENTS)) {
    assert.ok(index(type) >= 0, type);
    assert.ok(UNMEASURED_ACHIEVEMENTS[type].length > 0);
  }
  // Twenty of the twenty-two are counted from events the engine already raises.
  assert.equal(TT2_ACHIEVEMENTS.length - Object.keys(UNMEASURED_ACHIEVEMENTS).length, 20);
});

test('playing raises the tallies the achievements count', () => {
  const s = fresh(1000);
  s.level = 500; s.heroes[0] = 50;
  const before = {
    taps: toNumber(achievementProgress(s, index('TapCount'))),
    kills: toNumber(achievementProgress(s, index('MonsterKill'))),
    gold: toNumber(achievementProgress(s, index('CollectGold'))),
  };
  for (let n = 0; n < 40; n++) apply(s, { type: 'tap', at: s.last + 100 });
  assert.ok(toNumber(achievementProgress(s, index('TapCount'))) > before.taps);
  assert.ok(toNumber(achievementProgress(s, index('MonsterKill'))) > before.kills);
  assert.ok(toNumber(achievementProgress(s, index('CollectGold'))) > before.gold);
  // The lifetime tally never falls when the balance is spent.
  const collected = achievementProgress(s, index('CollectGold'));
  apply(s, { type: 'upgrade', amount: 1, at: s.last });
  assert.deepEqual(achievementProgress(s, index('CollectGold')), collected);
});

test('claiming pays each tier once and only for tiers actually reached', () => {
  const s = fresh(1000);
  s.taps = 1000; // first TapCount tier
  const i = index('TapCount');
  assert.equal(achievementTier(s, i), 1);
  assert.equal(achievementReward(s, i), 5);
  const diamonds = s.diamonds;
  act(s, 'achievement', i);
  assert.equal(s.diamonds, diamonds + 5);
  assert.equal(achievementClaimed(s, i), 1);
  // A second claim pays nothing until the next tier is reached.
  act(s, 'achievement', i);
  assert.equal(s.diamonds, diamonds + 5);
  s.taps = 1e5;
  assert.equal(achievementTier(s, i), 3);
  assert.equal(achievementReward(s, i), 10 + 15);
  act(s, 'achievement', i);
  assert.equal(s.diamonds, diamonds + 5 + 10 + 15);
  assert.equal(achievementReward(s, i), 0);
});

test('an achievement the engine cannot measure cannot be claimed', () => {
  const s = fresh(1000);
  s.diamonds = 100;
  for (const type of Object.keys(UNMEASURED_ACHIEVEMENTS)) {
    const i = index(type);
    act(s, 'achievement', i);
    assert.equal(s.diamonds, 100, type);
    assert.equal(achievementClaimed(s, i), 0, type);
  }
  // An index outside the table changes nothing either.
  for (const i of [-1, 22, 1.5, NaN]) act(s, 'achievement', i);
  assert.equal(s.diamonds, 100);
});

test('claimed tiers survive a save round trip and a prestige', () => {
  const s = fresh(1000);
  s.taps = 1e4; s.best = 60;
  act(s, 'achievement', index('TapCount'));
  const claimed = achievementClaimed(s, index('TapCount'));
  assert.equal(claimed, 2);
  const loaded = hydrate(JSON.parse(JSON.stringify(s)));
  assert.equal(achievementClaimed(loaded, index('TapCount')), claimed);
  const after = apply(loaded, { type: 'prestige', at: loaded.last });
  assert.equal(achievementClaimed(after, index('TapCount')), claimed);
  assert.equal(after.stage, 1);
});

test('a save from before the table existed loads with nothing claimed and nothing paid', () => {
  // The list this project used to carry was never claimable and never written to, so an array
  // left in the field names nothing in the package table.
  const legacy = { ...fresh(1000), achievements: [0, 1, 2] };
  const s = hydrate(JSON.parse(JSON.stringify(legacy)));
  assert.deepEqual(s.achievements, {});
  assert.equal(s.diamonds, legacy.diamonds);
  for (let i = 0; i < TT2_ACHIEVEMENTS.length; i++) assert.equal(achievementClaimed(s, i), 0);
  // The tallies an older save has never seen start at zero rather than undefined.
  const missing = hydrate({ ...JSON.parse(JSON.stringify(fresh(1000))), achievements: undefined });
  delete missing.tt2.crits;
  const repaired = hydrate(missing);
  assert.equal(repaired.tt2.crits, 0);
  assert.deepEqual(repaired.tt2.goldCollected, { s: 0, e: 0 });
});
