import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import {
  fresh, advance, apply, goldReward, chestersonStackLength, chestersonActive, chestChance,
  CHESTERSON,
} from '../lib/engine.ts';
import { effect } from '../lib/tt2-rules.ts';
import { toNumber } from '../lib/big-number.ts';

const evidence = JSON.parse(readFileSync(new URL('special-titan-evidence.json', referenceRoot), 'utf8'));
const statics = JSON.parse(readFileSync(new URL('servervar-defaults.json', referenceRoot), 'utf8'));

const INCENSE = 57;       // Chesterson Incense: ChestersonGoldStageAmount, +1 stage a level
const SET_DURATION = 51;  // SpecialTitanStackDurationMult

/** A save that has prestiged, since the native gate requires it. */
const prestiged = () => {
  const s = fresh(1000);
  s.prestiges = 1;
  return s;
};

test('五段算式都在證據裡，而且是這一份安裝包的', () => {
  assert.equal(evidence.formulas.chestersonStackCap, '常數 1');
  assert.equal(evidence.formulas.chestersonGate,
    'NumOfStacks < 1 且 PrestigeModel.HasPrestigedBefore()');
  assert.equal(evidence.formulas.chestersonStackLength,
    'floor((ChestersonGoldStageAmount + chestersonGoldDuration) × SpecialTitanStackDurationMult)');
  assert.equal(evidence.formulas.chestersonGold, 'treasureGold × ChestAmount');
  assert.match(evidence.formulas.chestersonEffect, /MonsterClass\.Chesterson/);

  const named = kind => evidence.traces[kind].filter(e => e[0] === 'GetBonus').map(e => e[1]);
  assert.deepEqual(named('chestersonStackLength'),
    ['ChestersonGoldStageAmount', 'SpecialTitanStackDurationMult']);
  assert.deepEqual(named('chestersonGold'), ['ChestAmount']);
  // The gate ends in a tail call to the prestige check - that is what makes it a gate.
  assert.deepEqual(evidence.traces.chestersonGate.filter(e => e[0] === 'tail').map(e => e[1]),
    ['HasPrestigedBefore']);
});

test('引擎用的兩個靜態值就是證據上的值', () => {
  assert.equal(CHESTERSON.stageLength, evidence.statics.chestersonGoldDuration.value);
  assert.equal(CHESTERSON.treasureGold, evidence.statics.treasureGold.value);
  assert.equal(CHESTERSON.stageLength, statics.recovered.chestersonGoldDuration.value);
  assert.equal(CHESTERSON.treasureGold, statics.recovered.treasureGold.value);
  assert.equal(CHESTERSON.treasureGold, 15, '以前寫死 10，原生是 15');
});

test('乾淨存檔一疊是五關，天賦每級加一關', () => {
  const s = prestiged();
  assert.equal(chestersonStackLength(s), 5);

  for (const level of [1, 5, 40]) {
    const t = prestiged();
    t.tt2.tree[INCENSE] = level;
    const added = effect(t.tt2, 'ChestersonGoldStageAmount');
    assert.equal(chestersonStackLength(t), Math.floor(added + 5), `${level} 級`);
  }

  // The duration multiplier scales the whole thing, including the base.
  const longer = prestiged();
  longer.tt2.sets = [SET_DURATION];
  const mult = effect(longer.tt2, 'SpecialTitanStackDurationMult');
  assert.ok(mult > 1);
  assert.equal(chestersonStackLength(longer), Math.floor(5 * mult));
});

test('寶箱金幣的倍率是 15 × ChestAmount，不是 10', () => {
  const s = prestiged();
  const plain = toNumber(goldReward(s, 'monster'));
  const chest = toNumber(goldReward(s, 'chest'));
  assert.ok(Math.abs(chest / plain - CHESTERSON.treasureGold * effect(s.tt2, 'ChestAmount')) < 1e-6);
  assert.ok(Math.abs(chest / plain - 15) < 1e-6, '乾淨存檔剛好是 15 倍');
});

test('還沒蛻變過就不會有寶箱泰坦', () => {
  const s = fresh(1000);
  assert.equal(s.prestiges, 0);
  s.heroes = s.heroes.map(() => 400);
  // Force the roll to certainty so only the prestige gate can stop it.
  s.tt2.artifacts = s.tt2.artifacts.map(() => 0);
  let now = s.last;
  for (let n = 0; n < 3000; n++) {
    now += 120;
    apply(s, { type: 'tap', at: now });
    assert.equal(chestersonActive(s), false, '沒蛻變過不該開啟寶箱效果');
  }
  assert.equal(s.tt2.chestKills, 0, '沒蛻變過不該打到寶箱泰坦');
});

test('效果作用中，那幾關的每一隻都是寶箱泰坦', () => {
  const s = prestiged();
  s.heroes = s.heroes.map(() => 400);
  // Long enough that the run below never leaves the effect, so every kill in it is inside.
  s.tt2.chestStages = 200;
  const before = s.tt2.chestKills;
  const goldBefore = toNumber(s.gold);

  let now = s.last;
  for (let n = 0; n < 60; n++) {
    now += 120;
    apply(s, { type: 'tap', at: now });
  }
  assert.ok(chestersonActive(s), '這一段不該跑出效果之外，否則下面的比較沒有意義');
  assert.ok(s.tt2.chestKills > before, '效果作用中每一隻都該算寶箱');
  assert.ok(toNumber(s.gold) > goldBefore);
  // Every non-boss kill in that window counted as a chest, so the two tallies move together.
  assert.equal(s.tt2.chestKills - before, s.totalKills - s.bossKills,
    '效果作用中，非頭目的擊殺數與寶箱數應該一致');
});

test('效果一結束，寶箱就不再自動給', () => {
  const s = prestiged();
  s.heroes = s.heroes.map(() => 400);
  s.tt2.chestStages = 1;
  // Run past the end of the effect, then measure only what happens after it lapsed.
  let now = s.last;
  for (let n = 0; n < 20000 && chestersonActive(s); n++) {
    now += 120;
    apply(s, { type: 'tap', at: now });
  }
  assert.equal(chestersonActive(s), false);

  const chestAfter = s.tt2.chestKills, killsAfter = s.totalKills, bossAfter = s.bossKills;
  for (let n = 0; n < 200; n++) {
    now += 120;
    apply(s, { type: 'tap', at: now });
    if (chestersonActive(s)) break;
  }
  const normal = (s.totalKills - killsAfter) - (s.bossKills - bossAfter);
  assert.ok(normal > 0, '效果結束後仍要繼續打得動');
  assert.ok(s.tt2.chestKills - chestAfter < normal,
    '效果結束後不該每一隻都還是寶箱');
});

test('每清一關剩餘關數減一，歸零就結束', () => {
  const s = prestiged();
  s.tt2.chestStages = 2;
  s.heroes = s.heroes.map(() => 400);

  const seen = [];
  let now = s.last, stage = s.stage;
  for (let n = 0; n < 20000 && s.tt2.chestStages > 0; n++) {
    now += 120;
    apply(s, { type: 'tap', at: now });
    if (s.stage !== stage) { stage = s.stage; seen.push(s.tt2.chestStages); }
  }
  assert.deepEqual(seen, [1, 0], '兩關之後效果就結束');
  assert.equal(chestersonActive(s), false);
});

test('被效果轉成寶箱的那些不會讓效果續期', () => {
  const s = prestiged();
  s.heroes = s.heroes.map(() => 400);
  s.tt2.chestStages = 1;
  // Kill through this stage: every titan counts as a chest, but none of them may re-arm the timer.
  let now = s.last;
  const stage = s.stage;
  for (let n = 0; n < 20000 && s.stage === stage; n++) {
    now += 120;
    apply(s, { type: 'tap', at: now });
  }
  assert.ok(s.stage > stage);
  assert.equal(s.tt2.chestStages, 0, '整關都是寶箱，但沒有一隻讓它續期');
});

test('沒有效果時，寶箱仍然是罕見的擲骰', () => {
  const s = prestiged();
  s.heroes = s.heroes.map(() => 400);
  assert.equal(chestChance(s), Math.fround(0.01));
  let now = s.last;
  for (let n = 0; n < 4000; n++) {
    now += 120;
    apply(s, { type: 'tap', at: now });
  }
  // A chest kill arms the effect, which then converts a stage's worth - so this only checks the
  // effect does not stay on forever, not that chests themselves are rare.
  assert.ok(s.totalKills > 0);
  assert.ok(s.tt2.chestStages <= chestersonStackLength(s));
});

test('2.18.0 之前的存檔沒有這個欄位，補成沒有效果', () => {
  const s = prestiged();
  delete s.tt2.chestStages;
  advance(s, s.last + 1);
  assert.equal(s.tt2.chestStages, 0);
  assert.equal(chestersonActive(s), false);

  // Junk must not become an effect that never ends.
  const broken = prestiged();
  broken.tt2.chestStages = -5;
  advance(broken, broken.last + 1);
  assert.equal(broken.tt2.chestStages, 0);

  const fractional = prestiged();
  fractional.tt2.chestStages = 3.9;
  advance(fractional, fractional.last + 1);
  assert.equal(fractional.tt2.chestStages, 3);
});
