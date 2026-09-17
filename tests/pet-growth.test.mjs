import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { loadRegister } from '../tools/formula-sources.mjs';
import { fresh } from '../lib/engine.ts';
import { TT2_PETS } from '../lib/tt2-data.ts';
import { petBonus } from '../lib/tt2-rules.ts';
import { petDamageFactor } from '../lib/tt2-pet-combat.ts';
import { N } from './amounts.mjs';

const evidence = JSON.parse(readFileSync(new URL('pet-growth-evidence.json', referenceRoot), 'utf8'));
const table = JSON.parse(readFileSync(new URL('PetInfo.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));
const rows = Object.fromEntries(table.records.map(row => [row.values.PetID, row.values]));

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
  assert.match(evidence.binarySha256, /^[0-9a-f]{64}$/);
});

test('引擎的 30 隻寵物與 8.2 的 PetInfo 逐格相同', () => {
  assert.equal(TT2_PETS.length, evidence.matchesEngine.tableRows.count);
  for (const pet of TT2_PETS) {
    const row = rows[pet.id];
    assert.ok(row, `${pet.id} 不在 8.2 表裡`);
    for (const [key, column] of [['base', 'BonusBase'], ['inc', 'BonusInc'],
      ['improvement', 'ImprovementBonus'], ['improvementMax', 'MaxImprovementLevels'],
      ['damage', 'DamageBase'], ['unlock', 'UnlockStage']]) {
      assert.equal(pet[key], Number(row[column]), `${pet.id} 的 ${key}`);
    }
    assert.deepEqual([...pet.damageInc],
      [row.DamageInc1to40, row.DamageInc41to80, row.DamageInc80on].map(Number), `${pet.id} 的三段增量`);
  }
});

test('三段傷害的門檻就是原生的兩個 [ServerVar]，引擎的分段與之等價', () => {
  const { petDamageIncLevel1: first, petDamageIncLevel2: second } =
    evidence.matchesEngine.damageBands.boundaries;
  assert.equal(first, 40);
  assert.equal(second, 80);
  const pet = TT2_PETS[0];
  // Read the bands straight off the native shape and check the engine agrees at each boundary.
  const native = level => pet.damage + pet.damageInc[0] * Math.min(level, first)
    + pet.damageInc[1] * Math.min(Math.max(level - first, 0), second - first)
    + pet.damageInc[2] * Math.max(level - second, 0);
  const s = fresh(1000);
  s.tt2.activePets = [0, -1];
  for (const level of [1, 39, 40, 41, 79, 80, 81, 500]) {
    s.tt2.petLevels = TT2_PETS.map(() => 0);
    s.tt2.petLevels[0] = level;
    // petDamageFactor is 1 + the active pet's own amount when it is the only pet with levels.
    assert.ok(Math.abs(N(petDamageFactor(s.tt2)) - (1 + native(level))) < 1e-9, `等級 ${level}`);
  }
});

test('未出戰的比例是每 5 級 0.05，夾在 1', () => {
  const { gap, increment } = evidence.matchesEngine.passiveShare;
  assert.equal(gap, 5);
  assert.equal(increment, Math.fround(0.01));
  // Native: Min(1, gap * increment * (level / gap)) with an integer division.
  const native = level => Math.min(1, gap * increment * Math.floor(level / gap));
  const s = fresh(1000);
  s.tt2.activePets = [-1, -1];
  for (const level of [1, 4, 5, 9, 10, 50, 99, 100, 500]) {
    s.tt2.petLevels = TT2_PETS.map(() => 0);
    s.tt2.petLevels[0] = level;
    const amount = TT2_PETS[0].base + level * TT2_PETS[0].inc;
    const steps = Math.max(0, Math.floor((Math.min(level, TT2_PETS[0].improvementMax) - 100) / 50));
    const expected = 1 + (amount * TT2_PETS[0].improvement ** steps - 1) * native(level);
    assert.ok(Math.abs(petBonus(s.tt2, 0) - expected) < 1e-6, `等級 ${level}`);
  }
});

test('改良段與原生不一致，差距逐級記錄下來了', () => {
  const step = evidence.differsFromEngine.improvementStep;
  assert.equal(step.serverVars.petImprovementLevelStart.value, 100);
  assert.equal(step.serverVars.petImprovementLevelDelta.value, 20, '原生每 20 級一段');
  assert.equal(step.differences.length, 3, '三處不同都要寫下來');
  // The engine is still on the 7.5 rule, on purpose: this pins the gap rather than the fix.
  const s = fresh(1000);
  s.tt2.activePets = [0, -1];
  for (const [level, expected] of Object.entries(step.sampleSteps)) {
    s.tt2.petLevels = TT2_PETS.map(() => 0);
    s.tt2.petLevels[0] = Number(level);
    const engine = Math.max(0,
      Math.floor((Math.min(Number(level), TT2_PETS[0].improvementMax) - 100) / 50));
    assert.equal(engine, expected.engineSteps, `等級 ${level} 的引擎段數`);
    assert.notEqual(expected.nativeSteps, undefined);
  }
  // Below the start level the native multiplier drops under 1; the engine floors it at 1.
  assert.ok(step.sampleSteps['1'].nativeSteps < 0);
  assert.equal(step.sampleSteps['1'].engineSteps, 0);
  // At 1600 the native step count is more than double the engine's, and 1.5 to that difference
  // is where the whole disagreement shows up.
  assert.ok(step.sampleSteps['1600'].ratioWhenImprovementIs1_5 > 1e7);
  assert.equal(step.sampleSteps['100'].ratioWhenImprovementIs1_5, 1, '起算那一級兩邊相同');
});

test('登記表把相同的三條升級、把改良段列為不一致', () => {
  const register = loadRegister();
  const bonus = register.formulas.find(formula => formula.id === 'petBonus');
  assert.ok(bonus, 'petBonus 要有自己的登記條目');
  const differing = bonus.parts.filter(part => part.status === 'table-differs');
  assert.equal(differing.length, 1);
  assert.match(differing[0].note, /20/);
  assert.match(differing[0].note, /段數/);
  assert.match(differing[0].note, /待決定/);
  const combat = register.formulas.find(formula => formula.id === 'petCombat');
  assert.ok(!combat.parts.some(part => part.status === 'baseline-75'), '寵物這邊不該再有沿用 7.5 的條目');
  // Named, not counted: what this pass deliberately left unread.
  assert.equal(evidence.limits.length, 4);
  assert.ok(evidence.limits.some(limit => limit.includes('[ServerVar]')));
  assert.ok(evidence.limits.some(limit => limit.includes('Endgame')));
});
