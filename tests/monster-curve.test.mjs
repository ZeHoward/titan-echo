import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';

const load = name => JSON.parse(readFileSync(new URL(name + '.json', referenceRoot), 'utf8'));
const evidence = load('monster-curve-evidence');
const serverVars = load('ServerVarsInfo').records;
const overrides = load('ServerVarOverride').records;

test('monster health and gold share one native curve', () => {
  assert.equal(evidence.curves.health.method, 'MonsterModel.GetMonsterBaseHP');
  assert.equal(evidence.curves.gold.method, 'MonsterModel.GetMonsterBaseGold');
  assert.equal(evidence.sharedCurve.method, 'MonsterModel.GetMonsterBase');
  // The shared signature is what makes the two curves the same shape with different coefficients.
  assert.match(evidence.sharedCurve.signature, /int stageNum, int levelOff, int transcendenceLevelOff/);
  assert.match(evidence.sharedCurve.signature, /GHDouble base1, GHDouble base2, GHDouble base3/);
  assert.match(evidence.sharedCurve.signature, /double expo1, double expo2, double expo3, double expo4/);
});

test('each curve reads ten named server variables, matching the signature', () => {
  for (const curve of ['health', 'gold']) {
    const names = evidence.curves[curve].serverVars;
    assert.equal(names.length, 10, curve);
    assert.equal(new Set(names).size, 10, curve);
    for (const suffix of ['LevelOff', 'Mult', 'Base1', 'Base2', 'Base3', 'Expo1', 'Expo2', 'Expo3', 'Expo4']) {
      assert.ok(names.some(name => name.endsWith(suffix)), `${curve} 缺少 ${suffix}`);
    }
  }
  assert.deepEqual(evidence.curves.health.serverVars.filter(n => n.includes('Gold')), []);
  assert.deepEqual(evidence.curves.gold.serverVars.filter(n => n.includes('HP')), []);
});

test('the package carries none of the twenty coefficients', () => {
  const carried = Object.entries(evidence.bundledValues).filter(([, where]) => where.length);
  assert.deepEqual(carried, [], '若安裝包開始帶值，這條公式就能改為 table');
  assert.equal(Object.keys(evidence.bundledValues).length, 20);
  // Cross-check against the tables themselves rather than trusting the recorded summary alone.
  const known = new Set([...serverVars.map(row => row.id), ...overrides.map(row => row.id)]);
  for (const name of Object.keys(evidence.bundledValues)) assert.equal(known.has(name), false, name);
  // The one neighbouring variable the package does carry is the honour stage offset.
  assert.equal(serverVars.find(row => row.id === 'honourStageOffset').values.iOS, '250');
  assert.match(evidence.evidence.honourOffset, /honourStageOffset/);
});

test('共用曲線的形狀與十個係數都解出來了，並與引擎現值逐關對照', () => {
  const curve = evidence.sharedCurve;
  // The call order is the formula: Min, base1^that, x mult, then the Max/Pow tail twice.
  assert.deepEqual(curve.callsInOrder, [
    'System.Math$$Min', 'GHDouble$$Pow', 'GHDouble$$op_Multiply',
    'System.Math$$Max', 'System.Math$$Pow', 'GHDouble$$Pow', 'GHDouble$$op_Multiply',
    'System.Math$$Max', 'System.Math$$Pow', 'GHDouble$$Pow', 'GHDouble$$op_Division',
  ]);
  assert.deepEqual(curve.coefficients.health, {
    mult: 17.5, base1: 1.38, base2: 10, base3: 10,
    expo1: 0.03, expo2: 1.098, expo3: 1, expo4: 1.098,
    levelOff: 100, transcendenceLevelOff: 180000,
  });
  assert.equal(curve.coefficients.gold.expo1, 0.04);
  assert.equal(curve.coefficients.gold.expo2, 1.036);
  // The divisor only bites past stage 180000, which is above the 98000 cap.
  assert.ok(curve.coefficients.health.transcendenceLevelOff > 98000);
  // The comparison is what makes "not adopted" a decision rather than an oversight: the native
  // curve is already below the engine's by stage 250 and the gap only widens.
  const rows = Object.fromEntries(curve.comparison.map(row => [row.stage, row]));
  assert.ok(rows[100].nativeHealthLog10 > rows[100].engineHealthLog10, '第 100 關原生較高');
  assert.ok(rows[250].nativeHealthLog10 < rows[250].engineHealthLog10, '第 250 關原生已較低');
  assert.ok(rows[2000].engineHealthLog10 - rows[2000].nativeHealthLog10 > 100, '第 2000 關差距超過 100 個數量級');
  assert.ok(rows[2000].engineGoldLog10 > rows[2000].nativeGoldLog10, '金幣同向');
});

test('the surrounding static block is recorded, including what is not implemented yet', () => {
  const names = evidence.staticBlock.map(field => field.name);
  for (const name of ['monsterCountBase', 'monsterCountInc', 'monsterCountStageDelta',
    'bossHPModBase', 'bossHPModStageMult', 'monsterMinGoldDrop']) {
    assert.ok(names.includes(name), name);
  }
  assert.equal(evidence.staticBlock.length, 26);
  for (const field of evidence.staticBlock) {
    assert.match(field.offset, /^0x[0-9a-f]+$/);
    assert.ok(field.type.length > 0, field.name);
  }
  assert.match(evidence.evidence.consequence, /兩張變數表沒有帶值/);
  // The second line of evidence exists and is named, so the two are not confused with each other.
  assert.match(evidence.evidence.consequence, /servervar-defaults\.json/);
  assert.ok(evidence.limits.length >= 2);
});
