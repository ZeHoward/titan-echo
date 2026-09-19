import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import {
  fresh, goldReward, stageScaleGold, average10xGold, STAGE_SCALE_GOLD, BONUS_DEFAULTS,
} from '../lib/engine.ts';
import { ratio } from '../lib/big-number.ts';

const evidence = JSON.parse(readFileSync(new URL('stage-scale-gold-evidence.json', referenceRoot), 'utf8'));
const statics = JSON.parse(readFileSync(new URL('servervar-defaults.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));

/**
 * 妖精與寶箱之間除了關卡縮放還差一個十倍金幣的期望值：`Goldx10Chance` 有編譯期基礎值
 * 0.01，而寶箱那一端走的是擲骰那條路（本專案還沒有），所以只有妖精吃得到這 1.09。
 */
const TENX = average10xGold(BONUS_DEFAULTS.goldx10Chance);

/** A save with no sources at all, parked at one stage. */
const at = stage => {
  const s = fresh(1000);
  s.stage = stage;
  s.best = stage;
  return s;
};

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
});

test('曲線的形狀與兩個消費端都在證據裡', () => {
  assert.equal(evidence.formulas.stageScale,
    'max(stageScaleMinAmount, stageScaleSlope × 關卡^stageScaleExpo)');
  assert.deepEqual(Object.keys(evidence.consumers).sort(),
    ['FairyController$$GetFairyGoldAmount', 'PetModel$$GetPetHomGold']);
  assert.equal(evidence.consumers.FairyController$$GetFairyGoldAmount.base,
    'MonsterModel$$GetChestersonGold');
  assert.equal(evidence.consumers.FairyController$$GetFairyGoldAmount.exponent,
    'fairyGoldStageScaleExpo');
  // 除了那兩個消費端，只剩無參數多載自己轉呼叫一次。多出第四個呼叫者就是有新的消費端要接。
  assert.deepEqual(evidence.callers, [
    'FairyController$$GetFairyGoldAmount',
    'PetModel$$GetPetHomGold',
    'PlayerModel$$GetStageScaleGoldAmount',
  ]);
});

test('引擎的四個係數就是證據與變數表上的那幾個 float', () => {
  for (const [key, name] of [['minAmount', 'stageScaleMinAmount'], ['slope', 'stageScaleSlope'],
    ['expo', 'stageScaleExpo'], ['fairyExpo', 'fairyGoldStageScaleExpo']]) {
    assert.equal(STAGE_SCALE_GOLD[key], Math.fround(evidence.coefficients[name].value), name);
    assert.equal(evidence.coefficients[name].value, statics.recovered[name].value, name);
  }
});

test('下限不是裝飾：交叉點之前整條線都是那個常數', () => {
  for (const stage of [1, 10, 100, 458]) {
    assert.equal(stageScaleGold(stage), STAGE_SCALE_GOLD.minAmount, `第 ${stage} 關`);
  }
  // 0.001 × 關卡^1.24 在 459 關附近追過 2，之後就由斜率那一項決定。
  assert.ok(stageScaleGold(460) > STAGE_SCALE_GOLD.minAmount);
  assert.equal(stageScaleGold(10000),
    STAGE_SCALE_GOLD.slope*10000**STAGE_SCALE_GOLD.expo);
  let previous = 0;
  for (const stage of [1, 500, 1000, 5000, 10000, 50000, 98000]) {
    const value = stageScaleGold(stage);
    assert.ok(value >= previous, `第 ${stage} 關不該比前一關低`);
    previous = value;
  }
});

test('妖精金幣多出來的那一項，就是關卡縮放的 1.6 次方', () => {
  // 沒有任何來源時，妖精與寶箱只差 GoldSpecialty、FairyGold（都是 1）與這一項。
  for (const stage of [1, 100, 1000, 10000]) {
    const s = at(stage);
    const scaled = stageScaleGold(stage)**STAGE_SCALE_GOLD.fairyExpo*TENX;
    assert.ok(Math.abs(ratio(goldReward(s, 'fairy'), goldReward(s, 'chest'))/scaled-1) < 1e-9,
      `第 ${stage} 關的妖精金幣應該是寶箱的 ${scaled} 倍`);
  }
});

test('低關卡拿到的是常數倍，高關卡才真的拉開', () => {
  const early = at(100), late = at(10000);
  assert.ok(Math.abs(ratio(goldReward(early, 'fairy'), goldReward(early, 'chest'))
    -STAGE_SCALE_GOLD.minAmount**STAGE_SCALE_GOLD.fairyExpo*TENX) < 1e-9);
  assert.ok(ratio(goldReward(late, 'fairy'), goldReward(late, 'chest')) > 1000,
    '第一萬關的縮放要三位數以上，否則等於沒接');
});

test('縮放看的是目前所在的關卡，不是歷史最高', () => {
  // 兩個無參數多載都從 StageLogicController.currentStage 取關卡再往下傳，
  // 所以蛻變回第一關之後，妖精立刻跟著回到第一關的量。
  assert.equal(evidence.stageSource, 'StageLogicController.currentStage');
  const pushed = at(100);
  pushed.best = 98000;
  assert.ok(Math.abs(ratio(goldReward(pushed, 'fairy'), goldReward(at(100), 'fairy'))-1) < 1e-9,
    '推得再遠，站在第 100 關領到的還是第 100 關的量');
});

test('只有妖精那一端接上去，其他四種金幣一律沒動', () => {
  // 同一關的四種來源彼此之間只該差既有的那些倍率，跟關卡縮放無關；
  // 換一關之後比值不變，就表示沒有人偷偷多吃到這一項。
  const early = at(100), late = at(10000);
  for (const source of ['boss', 'chest', 'pet']) {
    const drift = ratio(goldReward(early, source), goldReward(early, 'monster'))
      /ratio(goldReward(late, source), goldReward(late, 'monster'));
    assert.ok(Math.abs(drift-1) < 1e-9, `${source} 的倍率不該隨關卡改變（${drift}）`);
  }
});

test('米達斯之心還沒接：那一端缺的是頭目平均金幣，不是這條縮放', () => {
  assert.equal(evidence.consumers.PetModel$$GetPetHomGold.base,
    'MonsterModel$$GetAverageBossGoldDrop');
  assert.equal(evidence.formulas.averageBossGold,
    'GetMonsterGoldDrop(關卡, MonsterClass.Boss, 1 隻, 變異) × '
    +'GetAverage10xGold(Goldx10Chance) × GetAverage10xGold(BossGoldx10Chance) × '
    +'GetAverageJackpotGold()');
  assert.equal(evidence.averageBossGold.monsterClass, 'Boss');
  assert.deepEqual(evidence.averageBossGold.averages, ['Goldx10Chance', 'BossGoldx10Chance']);
  // 引擎只帶妖精那個指數。哪天米達斯之心接上去，這則測試會提醒把 1.8 一起登記。
  assert.deepEqual(Object.keys(STAGE_SCALE_GOLD).sort(),
    ['expo', 'fairyExpo', 'minAmount', 'slope']);
  const s = at(10000), drift = ratio(goldReward(s, 'pet'), goldReward(at(100), 'pet'))
    /ratio(goldReward(s, 'boss'), goldReward(at(100), 'boss'));
  assert.ok(Math.abs(drift-1) < 1e-9, '寵物那一端還沒有自己的關卡縮放');
});
