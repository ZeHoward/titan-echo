import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { fresh, hydrate, cloakedStageSkip, stateEffect } from '../lib/engine.ts';
import { TT2_TREE, TT2_SETS } from '../lib/tt2-rules.ts';

const evidence = JSON.parse(readFileSync(new URL('cloaking-evidence.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));
const cloaking = TT2_TREE.findIndex(k => k.id === 'Cloaking');

function save({ level = 0, stage = 100, best = 200, sets = [] } = {}) {
  const s = hydrate(fresh(1000));
  s.tt2.tree[cloaking] = level;
  s.stage = stage; s.best = best; s.tt2.sets = sets;
  return s;
}

/** How often the skip fires over many kills on the same save. */
function rate(s, rolls = 4000) {
  let hit = 0;
  for (let i = 0; i < rolls; i++) if (cloakedStageSkip(s) > 0) hit++;
  return hit / rolls;
}

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
});

test('原生的順序是先看能不能潛行才擲骰', () => {
  assert.deepEqual(evidence.callOrder, [
    'Cloaking$$get_IsCloaking', 'Cloaking$$RollCloaking', 'Cloaking$$GetCloakingStagesSkipped']);
  assert.match(evidence.expression, /目前關卡 ≤ 最高關卡 \+ CloakedStageDuration/);
});

test('沒點天賦就不會觸發', () => {
  assert.equal(stateEffect(save(), 'CloakedSkipChance'), 0);
  assert.equal(rate(save({ level: 0 })), 0);
});

test('機率就是天賦那一級的值', () => {
  for (const level of [1, 5, 9]) {
    const s = save({ level });
    const chance = stateEffect(s, 'CloakedSkipChance');
    assert.ok(chance > 0);
    const measured = rate(s);
    assert.ok(Math.abs(measured - chance) < 0.04,
      `${level} 級的命中率應該接近 ${chance}，實測 ${measured.toFixed(3)}`);
  }
});

test('只在重打已經推過的關卡時有用，越不過自己的紀錄', () => {
  const duration = evidence.stageDuration.value;
  assert.equal(duration, 1);
  // 邊界之內：最高關卡加上那個持續值，仍然算潛行中。
  assert.ok(rate(save({ level: 9, stage: 200 + duration, best: 200 })) > 0.3);
  // 再前進一關就出界，完全不觸發。
  assert.equal(rate(save({ level: 9, stage: 200 + duration + 1, best: 200 })), 0);
});

test('跳的關數是加成值，套裝可以再加上去', () => {
  const s = save({ level: 9 });
  const base = stateEffect(s, 'CloakedSkipAmount');
  assert.equal(base, 10, '天賦本身給 10 關');
  const rogue = TT2_SETS.findIndex(x => x.id === 'Rogue');
  const withSet = save({ level: 9, sets: [rogue] });
  assert.ok(stateEffect(withSet, 'CloakedSkipAmount') > base, '套裝應該再加上去');
  let seen = 0;
  for (let i = 0; i < 200 && !seen; i++) seen = cloakedStageSkip(withSet);
  assert.equal(seen, Math.floor(stateEffect(withSet, 'CloakedSkipAmount')));
});

test('天賦第四欄的缺口有記下來，不是默默用掉', () => {
  const gap = evidence.talentFourthColumnGap;
  assert.equal(gap.count, 13);
  assert.ok(gap.talents.includes('Cloaking'));
  assert.match(gap.note, /只匯了前兩個加成欄/);
  assert.ok(evidence.limits.some(l => l.includes('第四欄尚未匯入')));
});
