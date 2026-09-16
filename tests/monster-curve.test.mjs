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
  assert.match(evidence.evidence.consequence, /安裝包沒有帶值/);
  assert.ok(evidence.limits.length >= 2);
});
