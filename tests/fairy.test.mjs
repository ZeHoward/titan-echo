import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import {
  fresh, advance, apply, goldReward, rollExtraFairies, fairiesUnlocked, qteReady, FAIRY, CHESTERSON,
  stageScaleGold, STAGE_SCALE_GOLD,
} from '../lib/engine.ts';
import { effect, QTE_TYPE, TT2_QTE } from '../lib/tt2-rules.ts';
import { toNumber } from '../lib/big-number.ts';

const evidence = JSON.parse(readFileSync(new URL('fairy-evidence.json', referenceRoot), 'utf8'));
const statics = JSON.parse(readFileSync(new URL('servervar-defaults.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));

const CHARM = 6;      // 天賦 Fairy Charm: FairySpawnChance, 滿級 +2.75
const SHIELD = 84;    // 神器 入侵者之盾: FairySpawnChance
const SET_SPAWN = 80; // 套裝: FairySpawnChance +1.0

/** A save past the stage gate, so the fairy action is available. */
const ready = () => {
  const s = fresh(1000);
  s.best = FAIRY.startStage;
  return s;
};

/**
 * Walk the clock in steps small enough to stay on the tick path - the offline path deliberately
 * shifts the QTE timers by the gap instead of running them, so one big jump never lands a fairy.
 */
const waitForFairy = s => {
  const limit = s.last + TT2_QTE[QTE_TYPE.Fairy].cooldown * 2000;
  while (!qteReady(s.tt2, QTE_TYPE.Fairy) && s.last < limit) advance(s, s.last + 10000);
  assert.ok(qteReady(s.tt2, QTE_TYPE.Fairy), '妖精應該在兩倍冷卻之內出現');
  return s;
};

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
});

test('迴圈的形狀與金幣的來源都在證據裡', () => {
  assert.equal(evidence.formulas.firstFairy, '無條件生成一隻');
  assert.equal(evidence.formulas.extraChance,
    'FairySpawnChance × AllProbabilityBoost（基礎值 0）');
  assert.equal(evidence.formulas.stageGate, 'GetMaxStageReached() ≥ fairyStartStage');

  const named = kind => evidence.traces[kind].filter(e => e[0] === 'GetBonus').map(e => e[1]);
  assert.deepEqual(named('multiSpawn'), ['FairySpawnChance', 'AllProbabilityBoost']);
  // The gold chain must still start from a treasure titan's payout, which is the whole reason
  // the engine shares one constant between chests and fairies.
  const goldCalls = evidence.traces.gold.filter(e => e[0] === 'call').map(e => e[1]);
  assert.equal(goldCalls[0], 'GetChestersonGold');
  const chesterson = evidence.traces.chestersonGold.map(e => [e[0], e[1]]);
  assert.deepEqual(chesterson.filter(e => e[0] === 'arg'), [['arg', 'w2=3'], ['arg', 'w3=1']],
    'GetChestersonGold 要以 MonsterClass.Chesterson、一隻去問金幣');
  assert.ok(chesterson.some(e => e[1] === 'GetMonsterGoldDrop'));
});

test('引擎用的三個靜態值就是證據上的值', () => {
  assert.equal(FAIRY.maxExtraSpawns, evidence.statics.maxExtraMultiFairySpawns.value);
  assert.equal(FAIRY.multiSpawnPenalty,
    Math.fround(evidence.statics.multiFairySpawnPenalty.value));
  assert.equal(FAIRY.startStage, evidence.statics.fairyStartStage.value);
  assert.equal(FAIRY.maxExtraSpawns, statics.recovered.maxExtraMultiFairySpawns.value);
  assert.equal(FAIRY.startStage, statics.recovered.fairyStartStage.value);
});

test('沒有來源就永遠只有一隻：基礎值是 0，不是別的數字', () => {
  const s = ready();
  assert.equal(effect(s.tt2, 'FairySpawnChance'), 0, '加法型且沒有基礎值條目');
  for (let n = 0; n < 200; n++) assert.equal(rollExtraFairies(s), 0);
});

test('三種來源都能拉出額外妖精，而且夾在上限內', () => {
  for (const [label, arm] of [
    ['天賦', s => { s.tt2.tree[CHARM] = 9; }],
    ['神器', s => { s.tt2.artifacts[SHIELD] = 50; }],
    ['套裝', s => { s.tt2.sets = [SET_SPAWN]; }],
  ]) {
    const s = ready();
    arm(s);
    assert.ok(effect(s.tt2, 'FairySpawnChance') > 0, `${label}要給機率`);
    let seen = 0, max = 0;
    for (let n = 0; n < 400; n++) {
      const extra = rollExtraFairies(s);
      assert.ok(Number.isInteger(extra) && extra >= 0 && extra <= FAIRY.maxExtraSpawns,
        `${label}: ${extra} 超出 0..${FAIRY.maxExtraSpawns}`);
      if (extra > 0) seen++;
      max = Math.max(max, extra);
    }
    assert.ok(seen > 0, `${label}應該真的拉得出額外妖精`);
  }
});

test('機率大於 1 的時候前幾輪必中，而且照 0.5 遞減', () => {
  const s = ready();
  s.tt2.tree[CHARM] = 9;
  const chance = effect(s.tt2, 'FairySpawnChance') * effect(s.tt2, 'AllProbabilityBoost');
  assert.ok(chance > 1, '滿級的妖精魅力應該超過 1');
  // 2.75 -> 1.375 -> 0.6875: the first two rounds cannot miss, so every roll gives at least two.
  const certain = Math.floor(Math.log(1 / chance) / Math.log(FAIRY.multiSpawnPenalty)) + 1;
  assert.ok(certain >= 2);
  for (let n = 0; n < 200; n++) {
    assert.ok(rollExtraFairies(s) >= certain, `機率 ${chance} 下至少該有 ${certain} 隻`);
  }
});

test('推到第十關才有妖精', () => {
  const early = fresh(1000);
  early.best = FAIRY.startStage - 1;
  assert.equal(fairiesUnlocked(early), false);

  const at = fresh(1000);
  at.best = FAIRY.startStage;
  assert.equal(fairiesUnlocked(at), true);

  // The action itself is gated, not just the helper. The QTE still runs - natively OnQTEReady is
  // raised either way and the fairy simply is not spawned - so a ready fairy must still pay nothing.
  const before = toNumber(early.gold);
  waitForFairy(early);
  apply(early, { type: 'fairy', at: early.last });
  assert.equal(toNumber(early.gold), before, '還沒到第十關就不該領得到');
  assert.equal(early.tt2.fairyRewards, 0);
});

test('領一次妖精至少給一份，有來源時給好幾份', () => {
  const plain = ready();
  plain.stage = 50;
  plain.best = 50;
  waitForFairy(plain);
  apply(plain, { type: 'fairy', at: plain.last });
  assert.equal(plain.tt2.fairyRewards, 1, '沒有來源就是一隻');
  assert.equal(plain.daily.fairies, 1);
  const one = toNumber(plain.gold);
  assert.ok(one > 0);

  const charmed = ready();
  charmed.stage = 50;
  charmed.best = 50;
  charmed.tt2.tree[CHARM] = 9;
  waitForFairy(charmed);
  apply(charmed, { type: 'fairy', at: charmed.last });
  assert.ok(charmed.tt2.fairyRewards > 1, '滿級妖精魅力應該一次來好幾隻');
  assert.equal(charmed.daily.fairies, charmed.tt2.fairyRewards, '每日計數要跟著一起走');
  // The gold has to scale with the count, not stay at one fairy's worth.
  assert.ok(Math.abs(toNumber(charmed.gold) / one - charmed.tt2.fairyRewards) < 1e-6);
});

test('妖精金幣起算於寶箱那個 15，再乘上關卡縮放', () => {
  const s = ready();
  const monster = toNumber(goldReward(s, 'monster'));
  const chest = toNumber(goldReward(s, 'chest'));
  const fairy = toNumber(goldReward(s, 'fairy'));
  assert.ok(Math.abs(chest / monster - CHESTERSON.treasureGold) < 1e-6);
  // A fairy also carries GoldSpecialty and FairyGold, both neutral on a clean save.
  assert.equal(effect(s.tt2, 'GoldSpecialty'), 1);
  assert.equal(effect(s.tt2, 'FairyGold'), 1);
  // 兩者之間剩下的就是原生 GetFairyGoldAmount 在 GetChestersonGold 之後乘的那一項：
  // 關卡縮放的 fairyGoldStageScaleExpo 次方。這一關還落在下限上，所以是個常數倍。
  const scaled = stageScaleGold(s.stage) ** STAGE_SCALE_GOLD.fairyExpo;
  assert.equal(stageScaleGold(s.stage), STAGE_SCALE_GOLD.minAmount);
  assert.ok(Math.abs(fairy / monster - CHESTERSON.treasureGold * scaled) < 1e-6,
    '乾淨存檔的妖精應該是寶箱的關卡縮放倍');
});

test('領完就進冷卻，而且不會因為多重妖精被繞過', () => {
  const s = ready();
  s.stage = 50;
  s.best = 50;
  waitForFairy(s);
  apply(s, { type: 'fairy', at: s.last });
  const after = s.tt2.fairyRewards;
  assert.ok(after >= 1);
  assert.equal(qteReady(s.tt2, QTE_TYPE.Fairy), false, '領完就該回到冷卻');
  apply(s, { type: 'fairy', at: s.last + 1000 });
  assert.equal(s.tt2.fairyRewards, after, '冷卻內再按不該再給');
  waitForFairy(s);
  apply(s, { type: 'fairy', at: s.last });
  assert.ok(s.tt2.fairyRewards > after, '冷卻過了才能再領');
});
