import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { fresh, hydrate, monsterCount, stateEffect } from '../lib/engine.ts';
import { TT2_SETS, bonusDefinitions } from '../lib/tt2-rules.ts';

const evidence = JSON.parse(readFileSync(new URL('monster-count-reduction-evidence.json', referenceRoot), 'utf8'));
const curve = JSON.parse(readFileSync(new URL('monster-count-evidence.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));
const bane = TT2_SETS.findIndex(s => s.id === 'Bane');

function save({ stage = 1, sets = [] } = {}) {
  const s = hydrate(fresh(1000));
  s.stage = stage; s.best = Math.max(stage, 1); s.tt2.sets = sets;
  return s;
}

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
});

test('這個加成是減免，不是增加', () => {
  assert.equal(evidence.bonus.direction, 'subtract');
  assert.match(evidence.expression, /− MonsterCountPerStage/);
  assert.equal(bonusDefinitions.MonsterCountPerStage.additive, true);
});

test('沒有來源時隻數就是原本的曲線值', () => {
  assert.equal(stateEffect(save(), 'MonsterCountPerStage'), 0);
  // 曲線本身已由 2.12.9 釘住，這裡確認沒被這次的改動動到。
  for (const [stage, expected] of [[1, 8], [500, 10], [1000, 12], [2000, 17], [98000, 120]]) {
    assert.equal(monsterCount(save({ stage })), expected, `第 ${stage} 關`);
  }
});

test('剋星套裝讓每一關都少那麼多隻', () => {
  const cut = stateEffect(save({ sets: [bane] }), 'MonsterCountPerStage');
  assert.ok(cut > 0);
  for (const stage of [500, 1000, 2000, 98000]) {
    assert.equal(monsterCount(save({ stage, sets: [bane] })), monsterCount(save({ stage })) - cut,
      `第 ${stage} 關應該少 ${cut} 隻`);
  }
});

test('下限與截斷照原生做，但在現有資料下都碰不到——這件事本身要記著', () => {
  // 原生最後是 Math.Max(1, ...)，而加成轉 int 是截斷。兩者都照做了，可是用本專案現有的
  // 來源測不出差別：唯一給這個加成的是「剋星」套裝的整數 5，而最小隻數是第 1 關的 8。
  // 所以把下限拿掉、或把截斷換成四捨五入，行為都不會變——這裡把那個前提釘住，
  // 將來有小數或更大的減免來源出現時，這個測試會先轉紅，提醒那兩段開始有作用了。
  const sources = TT2_SETS.filter(s => JSON.stringify(s.effects || []).includes('"MonsterCountPerStage"'));
  assert.equal(sources.length, 1, '多了來源就要回頭檢查下限與截斷有沒有被驗到');
  const amount = sources[0].effects.find(e => e.type === 'MonsterCountPerStage').amount;
  assert.ok(Number.isInteger(amount), `來源給的是整數 ${amount}，所以截斷與四捨五入等價`);
  const smallest = monsterCount(save({ stage: 1 }));
  assert.ok(amount < smallest, `減免 ${amount} 小於最小隻數 ${smallest}，所以夾在 1 的那一步碰不到`);
  // 即使碰不到，行為仍要正確。
  const s = save({ stage: 1, sets: [bane] });
  assert.equal(monsterCount(s), Math.max(1, smallest - Math.trunc(amount)));
  assert.ok(monsterCount(s) >= 1);
});

test('未實作系統的那兩項有記下來，不是默默折算掉', () => {
  assert.equal(evidence.notImplementedHere.length, 2);
  assert.ok(evidence.notImplementedHere.some(x => x.includes('契約')));
  assert.ok(evidence.notImplementedHere.some(x => x.includes('特殊泰坦')));
  assert.match(evidence.signature, /splashSkip/);
  // 曲線那份證據仍然是這一份的基礎。
  assert.equal(curve.version, '8.2.0');
});
