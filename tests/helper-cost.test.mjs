import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { loadRegister } from '../tools/formula-sources.mjs';
import { fresh, cost, HELPER_DEFAULTS, HEROES } from '../lib/engine.ts';
import { toNumber } from '../lib/big-number.ts';

const evidence = JSON.parse(readFileSync(new URL('helper-cost-evidence.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
  assert.match(evidence.binarySha256, /^[0-9a-f]{64}$/);
});

test('公比是原生靜態預設值 float 1.08，類別建構式只寫入一次', () => {
  assert.equal(evidence.growthRate.field, 'ServerVarsModel.helperUpgradeBase');
  assert.equal(evidence.growthRate.rawBits, '0x3f8a3d71');
  assert.equal(evidence.growthRate.float, Math.fround(1.08));
  assert.equal(evidence.growthRate.writes.length, 1, '多於一處寫入就不能當成預設值');
  // It is the cost's ratio, not some unrelated field: the constructor derives the two quantities a
  // geometric series needs from it.
  assert.ok(evidence.derivedInConstructor.helperUpgradeBaseLog);
  assert.ok(evidence.derivedInConstructor.helperUpgradeBaseMinusOne);
  for (const call of ['GHDouble$$Pow', 'GHDouble$$op_Multiply']) {
    assert.ok(evidence.purchaseCost.calls.includes(call), call);
  }
});

test('引擎用的就是那個值，連 float 精度都一樣', () => {
  assert.equal(HELPER_DEFAULTS.costGrowth, evidence.growthRate.float);
  // Stored as a float in the binary, so the double 1.08 is not the same number.
  assert.notEqual(HELPER_DEFAULTS.costGrowth, 1.08);
});

test('相鄰兩級的費用比就是公比，十連等於等比和', () => {
  const s = fresh(1000);
  const ratio = HELPER_DEFAULTS.costGrowth;
  // Costs round up, so the ratio is only exact once the price is large enough for the rounding to
  // be negligible; at level 0 a 10-gold hero goes 10 -> 11 and reads as 1.1.
  for (const level of [100, 200, 400]) {
    s.heroes[0] = level;
    const one = toNumber(cost(s, 0, 1));
    s.heroes[0] = level + 1;
    const next = toNumber(cost(s, 0, 1));
    assert.ok(Math.abs(next / one - ratio) < 1e-4, `等級 ${level} 的費用比 ${next / one}`);
  }
  s.heroes[0] = 100;
  const ten = toNumber(cost(s, 0, 10));
  const sum = HEROES[0].base * (ratio ** 110 - ratio ** 100) / (ratio - 1);
  // cost() rounds the whole purchase up once, so the ten-at-once price is the sum plus under a gold.
  assert.ok(ten - sum >= 0 && ten - sum < 1, `十連 ${ten} 對等比和 ${sum}`);
});

test('登記為原生靜態預設值，並寫明它不是線上值', () => {
  const register = loadRegister();
  const hero = register.formulas.find(formula => formula.id === 'heroCost');
  const growth = hero.parts.find(part => part.part.includes('1.08'));
  assert.equal(growth.status, 'default');
  assert.equal(growth.ref, 'helper-cost-evidence.json');
  assert.match(hero.expression, /1\.08/);
  // The three int[] fields beside it are recorded as unresolved rather than quietly ignored.
  assert.equal(Object.keys(evidence.unresolved.fields).length, 3);
  assert.ok(evidence.limits.some(limit => limit.includes('[ServerVar]')));
});
