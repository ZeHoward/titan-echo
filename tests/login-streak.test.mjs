import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import {
  fresh, advance, apply, buildDamage, dayAt,
  consecutiveLoginDamage, loginStreakDays, loginStreakIntact, LOGIN_STREAK_DAYS,
} from '../lib/engine.ts';
import { effect } from '../lib/tt2-rules.ts';
import { toNumber } from '../lib/big-number.ts';

const evidence = JSON.parse(readFileSync(new URL('login-streak-evidence.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));

const SET_LOGIN = 36;   // 套裝: DamagePerConsecutiveLoginDay
const DAY = 86400000;

/** A save whose last collection was `daysAgo` days back, with the streak already at `streak`. */
const withStreak = (streak, daysAgo) => {
  const s = fresh(1000);
  s.tt2.sets = [SET_LOGIN];
  s.tt2.loginStreak = streak;
  s.tt2.loginAt = dayAt(s.last) - daysAgo;
  return s;
};

test('證據取自釘住的那份安裝包，四個狀態與上限都在裡面', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
  assert.deepEqual(evidence.states,
    { CAN_COLLECT_TODAY: 0, COLLECTED_TODAY: 1, MISSED_COLLECT_RESET: 2, ERROR: 3 });
  assert.equal(evidence.numberOfDays, LOGIN_STREAK_DAYS);
  assert.equal(evidence.formulas.cappedStreak, 'clamp(currentDayNumber − 1, 0, 14)');
  assert.match(evidence.formulas.damage, /Pow\(DamagePerConsecutiveLoginDay/);

  // The trace has to show the exponent path, or the "days are the exponent" claim is unsupported.
  const calls = evidence.traces.bonus.filter(e => e[0] === 'call').map(e => e[1]);
  assert.deepEqual(calls, ['GetCollected', 'Pow', 'ModifyBonus']);
  const bonuses = evidence.traces.bonus.filter(e => e[0] === 'GetBonus').map(e => e[1]);
  assert.deepEqual(bonuses, ['DamagePerConsecutiveLoginDay']);
});

test('沒有來源的存檔完全不受影響', () => {
  const s = fresh(1000);
  assert.equal(effect(s.tt2, 'DamagePerConsecutiveLoginDay'), 1, '乘法型，中性值是 1');
  s.tt2.loginStreak = 9;
  s.tt2.loginAt = dayAt(s.last);
  assert.equal(consecutiveLoginDamage(s), 1);
});

test('連續天數是指數，而且夾在十四天', () => {
  const per = effect(withStreak(1, 0).tt2, 'DamagePerConsecutiveLoginDay');
  assert.ok(per > 1, '這套套裝要給大於 1 的加成');

  // Day one is the first collection, so the exponent is zero - no bonus yet.
  assert.equal(loginStreakDays(withStreak(1, 0)), 0);
  assert.equal(consecutiveLoginDamage(withStreak(1, 0)), 1);

  for (const [streak, exponent] of [[2, 1], [5, 4], [15, 14], [40, 14]]) {
    const s = withStreak(streak, 0);
    assert.equal(loginStreakDays(s), exponent, `第 ${streak} 天`);
    assert.equal(consecutiveLoginDamage(s), per ** exponent);
  }
});

test('漏一天整項就歸零，不是慢慢遞減', () => {
  // Collected today, or yesterday: the streak still counts.
  for (const daysAgo of [0, 1]) {
    const s = withStreak(10, daysAgo);
    assert.equal(loginStreakIntact(s), true, `${daysAgo} 天前領的應該還算數`);
    assert.ok(consecutiveLoginDamage(s) > 1);
  }
  // Two days ago is a missed day: the whole term is gone, not reduced.
  for (const daysAgo of [2, 3, 30]) {
    const s = withStreak(10, daysAgo);
    assert.equal(loginStreakIntact(s), false, `${daysAgo} 天前領的不該還算數`);
    assert.equal(loginStreakDays(s), 0);
    assert.equal(consecutiveLoginDamage(s), 1, '中斷之後就是 1 倍，不是打折');
  }
});

test('這個加成真的進到傷害裡', () => {
  const plain = withStreak(1, 0);
  const streaked = withStreak(8, 0);
  const before = toNumber(buildDamage(plain, 'tap'));
  const after = toNumber(buildDamage(streaked, 'tap'));
  assert.ok(after > before, '連續登入八天的傷害要比第一天高');
  assert.ok(Math.abs(after / before - consecutiveLoginDamage(streaked)) < 1e-6,
    '差距就是這一項的倍率，沒有別的東西跟著動');

  // A broken streak puts it back exactly where it started.
  const broken = withStreak(8, 5);
  assert.ok(Math.abs(toNumber(buildDamage(broken, 'tap')) / before - 1) < 1e-6);
});

test('領獎接得下去就加一天，隔太久就從第一天重算', () => {
  // Yesterday's collection: today's carries on.
  const carry = fresh(1000);
  carry.tt2.loginStreak = 4;
  carry.tt2.loginAt = dayAt(carry.last) - 1;
  apply(carry, { type: 'daily', at: carry.last });
  assert.equal(carry.tt2.loginStreak, 5);
  assert.equal(carry.tt2.loginAt, dayAt(carry.last));

  // A gap: the streak restarts at one, not at zero and not where it was.
  const reset = fresh(1000);
  reset.tt2.loginStreak = 9;
  reset.tt2.loginAt = dayAt(reset.last) - 3;
  apply(reset, { type: 'daily', at: reset.last });
  assert.equal(reset.tt2.loginStreak, 1, '中斷之後第一次領取是第一天');
  assert.equal(loginStreakDays(reset), 0, '第一天還沒有加成');

  // The very first collection ever.
  const first = fresh(1000);
  apply(first, { type: 'daily', at: first.last });
  assert.equal(first.tt2.loginStreak, 1);
});

test('同一天領第二次不會把天數灌上去', () => {
  const s = fresh(1000);
  s.tt2.loginStreak = 3;
  s.tt2.loginAt = dayAt(s.last) - 1;
  apply(s, { type: 'daily', at: s.last });
  assert.equal(s.tt2.loginStreak, 4);
  apply(s, { type: 'daily', at: s.last + 1000 });
  assert.equal(s.tt2.loginStreak, 4, '同一天再按一次不該再加');
});

test('連續領十六天，指數停在十四', () => {
  const s = fresh(1000);
  s.tt2.sets = [SET_LOGIN];
  let at = s.last;
  for (let day = 0; day < 16; day++) {
    apply(s, { type: 'daily', at });
    at += DAY;
    advance(s, at);
  }
  assert.equal(s.tt2.loginStreak, 16);
  assert.equal(loginStreakDays(s), LOGIN_STREAK_DAYS, '第十六天的指數仍是十四');
});

test('2.20.0 之前的存檔沒有這個欄位，從 loginAt 推回來', () => {
  // Collected today: they are at least on day one.
  const recent = fresh(1000);
  recent.tt2.loginAt = dayAt(recent.last);
  delete recent.tt2.loginStreak;
  advance(recent, recent.last + 1);
  assert.equal(recent.tt2.loginStreak, 1);

  // Long gone: no streak at all.
  const stale = fresh(1000);
  stale.tt2.loginAt = dayAt(stale.last) - 10;
  delete stale.tt2.loginStreak;
  advance(stale, stale.last + 1);
  assert.equal(stale.tt2.loginStreak, 0);
  assert.equal(consecutiveLoginDamage(stale), 1);

  // Junk must not become a permanent bonus.
  const broken = fresh(1000);
  broken.tt2.loginStreak = -4;
  broken.tt2.loginAt = dayAt(broken.last);
  advance(broken, broken.last + 1);
  assert.ok(broken.tt2.loginStreak >= 0);
});
