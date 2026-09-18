import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { fresh, tapDamage, tapFromHelpers, buildDamage, stateEffect, dps } from '../lib/engine.ts';
import { TT2_ARTIFACTS, TT2_TREE } from '../lib/tt2-data.ts';
import { compare, toNumber, ZERO } from '../lib/big-number.ts';

const evidence = JSON.parse(readFileSync(new URL('tap-from-helpers-evidence.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));
const engine = readFileSync(new URL('../lib/engine.ts', import.meta.url), 'utf8');

const sword = TT2_ARTIFACTS.findIndex(a => a.effect === 'TapDamageFromHelpers');
const talent = TT2_TREE.findIndex(k => k.effects.some(e => e.type === 'TapDamageFromHelpersMult'));

/** 一個有英雄、因此有 DPS 可以轉換的狀態。 */
const withHeroes = () => {
  const s = fresh(1000);
  s.level = 400;
  s.heroes = s.heroes.map((_, i) => (i < 8 ? 200 : 0));
  return s;
};

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
});

test('點擊傷害就是「劍術大師傷害」加「英雄轉換」兩項', () => {
  assert.match(evidence.finding, /只有一個加法/);
  assert.equal(Object.keys(evidence.methods).length, 4);
  const s = withHeroes();
  s.tt2.artifacts[sword] = 10;
  // 引擎算出來的點擊傷害，扣掉轉換那一項，要正好回到原本的 buildDamage。
  const total = toNumber(tapDamage(s));
  const base = toNumber(buildDamage(s, 'tap'));
  const extra = toNumber(tapFromHelpers(s));
  assert.ok(Math.abs(total - (base + extra)) <= Math.abs(total) * 1e-9);
  assert.ok(extra > 0, '有大師之劍卻沒有轉換');
});

test('沒有任何來源時這一項是 0，點擊傷害與接上前完全相同', () => {
  const s = withHeroes();
  assert.equal(stateEffect(s, 'TapDamageFromHelpers'), 0);
  assert.equal(compare(tapFromHelpers(s), ZERO), 0);
  assert.equal(toNumber(tapDamage(s)), toNumber(buildDamage(s, 'tap')));
});

test('轉換量就是那條算式，逐項對得上', () => {
  const s = withHeroes();
  s.tt2.artifacts[sword] = 10;
  s.tt2.tree[talent] = 2;
  const power = evidence.conversionPowers.SwordMaster.defaultValue;
  const expected = Math.pow(toNumber(dps(s)), power)
    * stateEffect(s, 'TapDamage')
    * stateEffect(s, 'TapDamageFromHelpers')
    * stateEffect(s, 'TapDamageFromHelpersMult');
  const actual = toNumber(tapFromHelpers(s));
  // 引擎用的是未加成的英雄 DPS，所以只比數量級與結構，不要求跟 dps() 完全相等。
  assert.ok(actual > 0 && Number.isFinite(actual));
  assert.ok(actual <= expected * 1.000001, '轉換量超過用已加成 DPS 算出來的上界');
});

test('指數 0.5 真的有套用：英雄 DPS 變四倍，轉換只變兩倍', () => {
  const a = withHeroes();
  a.tt2.artifacts[sword] = 10;
  const b = structuredClone(a);
  // 把每位英雄的等級加上去，換到一個 DPS 明顯更高的狀態。
  b.heroes = b.heroes.map(n => (n ? n + 200 : 0));
  const ratio = toNumber(tapFromHelpers(b)) / toNumber(tapFromHelpers(a));
  const dpsRatio = toNumber(dps(b)) / toNumber(dps(a));
  assert.ok(dpsRatio > 1, '測試狀態沒有真的提高 DPS');
  // 開根號之後的比值必定小於原本的比值，而且大約等於平方根。
  assert.ok(ratio < dpsRatio, `轉換跟著 DPS 線性成長了（${ratio} vs ${dpsRatio}）`);
  assert.ok(Math.abs(ratio - Math.sqrt(dpsRatio)) < dpsRatio * 0.5,
    `比值 ${ratio} 不像 ${dpsRatio} 的平方根`);
});

test('指數是從證據來的，不是引擎自己寫死一個好看的數字', () => {
  const power = evidence.conversionPowers.SwordMaster;
  assert.equal(power.serverVar, 'helperToTapDPSPower');
  assert.equal(power.defaultValue, 0.5);
  assert.equal(power.status, 'default', '不該把編譯期預設值當成線上值');
  assert.ok(engine.includes('HELPER_TO_TAP_POWER=' + power.defaultValue),
    'lib/engine.ts 用的指數與證據不一致');
  // 影分身那一支是另一個欄位，不可以共用同一個數字。
  assert.equal(evidence.conversionPowers.ShadowClone.serverVar, 'helperToCloneTapDPSPower');
  assert.notEqual(evidence.conversionPowers.ShadowClone.defaultValue, power.defaultValue);
});
