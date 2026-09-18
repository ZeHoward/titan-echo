import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import {
  fresh, advance, apply, qteReady, helperOrbDamage, helperOrbBounces, dps,
} from '../lib/engine.ts';
import { TT2_QTE, QTE_TYPE, TT2_TREE, effect, qteUnlocked } from '../lib/tt2-rules.ts';
import { toNumber } from '../lib/big-number.ts';

const evidence = JSON.parse(readFileSync(new URL('helper-qte-evidence.json', referenceRoot), 'utf8'));
const coverage = JSON.parse(readFileSync(new URL('../docs/bonus-coverage.json', import.meta.url), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));
const rows = Object.fromEntries(coverage.rows.map(r => [r.id, r]));

const AWAKEN = TT2_TREE.findIndex(k => k.id === 'HelperDmgQTE');   // 天賦「星界覺醒」

/** A save with the talent learned and a few heroes hired, so dps() is non-zero. */
const armed = () => {
  const s = fresh(1000);
  s.best = 200;
  s.stage = 200;
  s.level = 200;
  s.heroes = s.heroes.map(() => 50);
  s.tt2.tree[AWAKEN] = TT2_TREE[AWAKEN].max;
  return s;
};
const waitForOrb = s => {
  const limit = s.last + TT2_QTE[QTE_TYPE.Helper].cooldown * 3000;
  while (!qteReady(s.tt2, QTE_TYPE.Helper) && s.last < limit) advance(s, s.last + 5000);
  return s;
};

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
});

test('撞擊的算式與三個係數就是證據上那一份', () => {
  assert.equal(evidence.formulas.orbHit,
    'GetAllHelperDPS × Bonus(HelperQTEDamage)'
    + ' × (helperQTEDamageOffset + helperQTEDamageMult × 威力^helperQTEDamageExpo)');
  assert.equal(evidence.statics.helperQTEDamageOffset.value, 1);
  assert.equal(evidence.statics.helperQTEDamageExpo.value, 2);
  assert.ok(Math.abs(evidence.statics.helperQTEDamageMult.value - 0.1) < 1e-7);
  // 只有一次乘法與一次加法，形狀不能被偷換。
  const orb = evidence.traces.orbDamage;
  assert.deepEqual(orb.filter(e => e[0] === 'fmul').map(e => e[1]), ['s0, s9, s8']);
  assert.deepEqual(orb.filter(e => e[0] === 'fadd').map(e => e[1]), ['s8, s10, s0']);
});

test('引擎算出來的撞擊傷害跟著威力平方成長', () => {
  const s = armed();
  const bonus = effect(s.tt2, 'HelperQTEDamage');
  assert.ok(bonus > 1, '滿級的星界覺醒應該給傷害加成');
  const base = toNumber(dps(s));
  // 係數是原生的 float，引擎用 Math.fround 保留那個精度，這裡要用同一個值比。
  const mult = Math.fround(0.1);
  for (const power of [0, 1, 2, 5]) {
    const want = base * bonus * (1 + mult * power ** 2);
    const got = toNumber(helperOrbDamage(s, power));
    assert.ok(Math.abs(got / want - 1) < 1e-9, `威力 ${power}：${got} 應該是 ${want}`);
  }
  // 威力 0 的時候就是 dps × 加成 × 1，不是 0。
  assert.ok(Math.abs(toNumber(helperOrbDamage(s, 0)) / (base * bonus) - 1) < 1e-9);
});

test('彈跳上限是 HelperQTECount，而本專案沒有來源所以是 0', () => {
  assert.equal(evidence.formulas.lastOrb, 'HelperQTEBounceCount >= (int)Bonus(HelperQTECount)');
  assert.equal(rows.HelperQTECount.sources, null,
    '哪天有來源了，這裡會轉紅，表示光球真的會彈');
  const s = armed();
  assert.equal(effect(s.tt2, 'HelperQTECount'), 0, '加法型且沒有來源');
  assert.equal(helperOrbBounces(s), 0);
});

test('沒學天賦就不排程，學了才進冷卻', () => {
  const bare = fresh(1000);
  bare.best = 200;
  assert.equal(qteUnlocked(bare.tt2, QTE_TYPE.Helper), false);
  advance(bare, bare.last + 10000);
  assert.equal(bare.tt2.qteReadyAt[QTE_TYPE.Helper], -1);

  const s = armed();
  advance(s, s.last + 5000);
  assert.ok(s.tt2.qteReadyAt[QTE_TYPE.Helper] > s.last);
});

test('點一下就撞一次，上限是 0 所以打完這一輪就結束', () => {
  const s = armed();
  waitForOrb(s);
  assert.equal(qteReady(s.tt2, QTE_TYPE.Helper), true);
  const before = toNumber(s.hp);

  apply(s, { type: 'tap', at: s.last + 50 });
  assert.equal(s.tt2.qteHelperPower, 0, '這一輪結束時威力歸零');
  assert.equal(qteReady(s.tt2, QTE_TYPE.Helper), false, '第一發就是最後一發');
  assert.ok(s.tt2.qteReadyAt[QTE_TYPE.Helper] > s.last, '回到冷卻');
  // 那一擊真的打在怪身上（血量掉了，或直接把這一波打完）。
  assert.ok(toNumber(s.hp) < before || s.kills > 0 || s.stage > 200);
});

test('有來源的話就會多彈幾次', () => {
  // 直接把上限灌進來，驗引擎照著彈而不是寫死一次。
  const s = armed();
  waitForOrb(s);
  const stub = { ...s, tt2: s.tt2 };
  let bounces = 0;
  // helperOrbBounces 讀的是加成，這裡用一個假的 resolver 模擬有來源的情況。
  const fake = id => (id === 'HelperQTECount' ? 3 : effect(s.tt2, id));
  assert.equal(helperOrbBounces(stub, fake), 3, '上限直接取自加成，沒有寫死');
  bounces = helperOrbBounces(stub, fake);
  assert.ok(bounces > 0);
});

test('持續期間的英雄傷害加成做了也不會生效', () => {
  assert.equal(evidence.formulas.buff,
    'AllHelperDamage ×= Pow(Bonus(HelperQTEDamage), Min(HelperQTEPower, Bonus(HelperQTECount)))');
  const buff = evidence.traces.buff
    .filter(e => ['GetBonus', 'ModifyBonus', 'read', 'call'].includes(e[0]))
    .map(e => [e[0], e[1]]);
  assert.deepEqual(buff, [
    ['GetBonus', 'HelperQTEDamage'], ['GetBonus', 'HelperQTECount'], ['read', 'HelperQTEPower'],
    ['call', 'op_Implicit'], ['call', 'Min'], ['call', 'op_Explicit'], ['call', 'Pow'],
    ['ModifyBonus', 'AllHelperDamage'],
  ], 'Min 在 Pow 之前，指數才會被上限夾住');
  // Min(威力, 0) = 0，Pow(任何數, 0) = 1，所以整個乘數恆為 1。
  assert.ok(evidence.blocked.buff.includes('恆為 1'));
});

test('一次點擊同時加威力與彈跳數，並重設過期', () => {
  assert.equal(evidence.formulas.tap,
    '一次點擊讓 HelperQTEPower 與 HelperQTEBounceCount 各加 1，並重設過期計時');
  const tap = evidence.traces.tapped.filter(e => ['read', 'write', 'add', 'call'].includes(e[0]));
  assert.deepEqual(tap.slice(0, 3).map(e => [e[0], e[1]]),
    [['read', 'HelperQTEPower'], ['add', 'v0.2s, v1.2s, v0.2s'], ['write', 'HelperQTEPower']],
    '原生用一道 NEON 加法一次加兩個欄位');
  assert.ok(tap.some(e => e[1] === 'RefreshExpire'));
});

test('限制寫在證據裡，沒有被悄悄拿掉', () => {
  const text = evidence.limits.join('\n');
  assert.match(text, /HelperQTECount 沒有來源/);
  assert.match(text, /合併成一個 qteHelperPower/);
  assert.match(text, /不跳泰坦也不跳關/);
  assert.ok(evidence.limits.length >= 6);
});

test('妖精與雷霆爆發沒有被這一段影響', () => {
  const s = armed();
  advance(s, s.last + 5000);
  assert.ok(s.tt2.qteReadyAt[QTE_TYPE.Fairy] > s.last, '妖精照樣排程');
  assert.equal(s.tt2.qteTaps, 0, '連打的計數只屬於雷霆爆發');
  assert.equal(s.tt2.qteHelperPower, 0);
});
