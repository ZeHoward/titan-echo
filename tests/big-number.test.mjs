import test from 'node:test';
import assert from 'node:assert/strict';
import { ONE, ZERO, add, compare, divide, fromNumber, fromStorage, multiply, negate, normalise, power,
  subtract, toNumber, toStorage } from '../lib/big-number.ts';

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * tolerance + Number.EPSILON,
    `${actual} 不接近 ${expected}`);

test('a value is normalised to one digit before the point, or an exact zero', () => {
  for (const value of [1, 9.99, 10, 1234, 1e30, 1e-30, -7, -1e12, 0.5]) {
    const big = fromNumber(value);
    if (value === 0) continue;
    assert.ok(Math.abs(big.s) >= 1 && Math.abs(big.s) < 10, `${value} -> ${big.s}`);
    assert.equal(Math.sign(big.s), Math.sign(value));
    close(toNumber(big), value);
  }
  assert.deepEqual(fromNumber(0), ZERO);
  assert.equal(toNumber(ZERO), 0);
  assert.equal(toNumber(ONE), 1);
  for (const bad of [NaN, Infinity, -Infinity]) assert.throws(() => fromNumber(bad), /必須是有限值/);
});

test('arithmetic stays exact enough for values a double cannot hold', () => {
  const huge = normalise(1, 400), alsoHuge = normalise(2, 400);
  const sum = add(huge, alsoHuge);
  assert.equal(sum.e, 400);
  close(sum.s, 3);
  const product = multiply(huge, alsoHuge);
  // 1e400 * 2e400 = 2e800: far beyond a double, and still exact here.
  assert.equal(product.e, 800);
  close(product.s, 2);
  const quotient = divide(product, huge);
  assert.equal(quotient.e, 400);
  close(quotient.s, 2);
  assert.deepEqual(subtract(huge, huge), ZERO);
  assert.equal(toNumber(multiply(huge, huge)), Number.MAX_VALUE, '超出 double 範圍時飽和而非 Infinity');
  assert.throws(() => divide(huge, ZERO), /不可除以零/);
});

test('adding a term too small to matter leaves the larger value untouched', () => {
  const big = normalise(1, 100);
  assert.deepEqual(add(big, fromNumber(1)), big);
  assert.deepEqual(add(fromNumber(1), big), big);
  // Within double precision the smaller term still counts.
  const nearby = add(normalise(1, 10), normalise(1, 9));
  close(nearby.s, 1.1);
  assert.equal(nearby.e, 10);
});

test('powers stay in log space so the exponent never overflows', () => {
  const base = normalise(2, 0);
  close(toNumber(power(base, 10)), 1024);
  const enormous = power(normalise(1, 100), 50);
  assert.equal(enormous.e, 5000);
  close(enormous.s, 1);
  assert.deepEqual(power(base, 0), ONE);
  assert.deepEqual(power(ZERO, 5), ZERO);
  // A negative base keeps its sign only for odd whole powers.
  assert.ok(power(normalise(-2, 0), 3).s < 0);
  assert.ok(power(normalise(-2, 0), 2).s > 0);
  assert.throws(() => power(normalise(-2, 0), 0.5), /非整數次方/);
  assert.throws(() => power(base, Infinity), /指數必須是有限值/);
});

test('comparison orders values across signs and magnitudes', () => {
  const values = [normalise(-1, 500), normalise(-1, 0), ZERO, fromNumber(0.5), ONE, normalise(9.9, 0),
    normalise(1, 1), normalise(1, 500)];
  for (let i = 1; i < values.length; i++) {
    assert.equal(compare(values[i], values[i - 1]), 1, `${toStorage(values[i])} 應大於 ${toStorage(values[i - 1])}`);
    assert.equal(compare(values[i - 1], values[i]), -1);
  }
  assert.equal(compare(ONE, fromNumber(1)), 0);
  assert.equal(compare(ZERO, ZERO), 0);
  assert.equal(compare(negate(ONE), ONE), -1);
});

test('storage text round-trips the pair without going through a double', () => {
  for (const big of [ZERO, ONE, normalise(1.5, 400), normalise(-3.25, -120), fromNumber(1234.5)]) {
    const text = toStorage(big);
    const back = fromStorage(text);
    assert.equal(compare(back, big), 0, text);
    assert.equal(toStorage(back), text);
  }
  assert.equal(toStorage(ZERO), '0');
  // Text a save might carry from elsewhere is rejected rather than silently coerced.
  for (const bad of ['', 'abc', '1e', 'e5', '1.5', 'Infinity', '1e5e5']) {
    assert.throws(() => fromStorage(bad), /無法解析的大數值/, bad);
  }
});

test('the representation matches the native number type this project recorded', async () => {
  const { readFileSync } = await import('node:fs');
  const { referenceRoot } = await import('../tools/reference-validation.mjs');
  const native = JSON.parse(readFileSync(new URL('native-number-type.json', referenceRoot), 'utf8'));
  assert.deepEqual(native.representation.parts, ['exponent', 'significand']);
  // Same two parts, so a later migration can map one to the other without inventing a shape.
  assert.deepEqual(Object.keys(fromNumber(5)).sort(), ['e', 's']);
});
