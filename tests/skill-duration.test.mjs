import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { fresh, hydrate, skillDuration, stateEffect, SKILLS, SKILL_DATA } from '../lib/engine.ts';
import { TT2_SETS, TT2_ARTIFACTS, bonusDefinitions } from '../lib/tt2-rules.ts';

const evidence = JSON.parse(readFileSync(new URL('skill-duration-evidence.json', referenceRoot), 'utf8'));
const coverage = JSON.parse(readFileSync(new URL('../docs/bonus-coverage.json', import.meta.url), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));
const hunter = TT2_SETS.findIndex(s => s.id === 'Hunter');

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
});

test('兩個加總的起點一個是 0 一個是 1，這是整條算式的關鍵', () => {
  assert.equal(evidence.seeds.seconds, 0);
  assert.equal(evidence.seeds.multiplier, 1);
  assert.deepEqual(evidence.bonusOrder.length, 4);
  assert.match(evidence.expression, /× \(1 \+/);
});

test('沒有來源時持續時間就是基礎值', () => {
  const s = hydrate(fresh(1000));
  assert.equal(stateEffect(s, 'AllActiveSkillDurationMult'), 0, '加法型加成沒有來源時是 0');
  for (let i = 0; i < SKILL_DATA.length; i++) assert.equal(skillDuration(s, i), SKILLS[i].duration);
});

test('獵人套裝讓每個技能的持續時間都乘上同一個倍率', () => {
  const s = hydrate(fresh(1000));
  s.tt2.sets = [hunter];
  const mult = 1 + stateEffect(s, 'AllActiveSkillDurationMult');
  assert.ok(mult > 1, '湊齊套裝應該真的提高倍率');
  for (let i = 0; i < SKILL_DATA.length; i++) {
    assert.ok(Math.abs(skillDuration(s, i) - SKILLS[i].duration * mult) < 1e-9 * SKILLS[i].duration * mult,
      `${SKILL_DATA[i].id} 應該是 ${SKILLS[i].duration} × ${mult}`);
  }
});

test('秒數那一組也要接上：神器「幽靈鐘錶」加的是秒數，不是倍率', () => {
  const clock = TT2_ARTIFACTS.findIndex(a => a.effect === 'AllActiveSkillDuration');
  assert.ok(clock >= 0, '應該有一件給 AllActiveSkillDuration 的神器');
  const s = hydrate(fresh(1000));
  s.tt2.artifacts[clock] = 40;
  const seconds = stateEffect(s, 'AllActiveSkillDuration');
  assert.ok(seconds > 0, '升級那件神器應該真的加秒數');
  for (let i = 0; i < SKILL_DATA.length; i++) {
    assert.ok(Math.abs(skillDuration(s, i) - (SKILLS[i].duration + seconds)) < 1e-9 * (SKILLS[i].duration + seconds),
      `${SKILL_DATA[i].id} 應該是 ${SKILLS[i].duration} + ${seconds} 秒`);
  }
});

test('秒數與倍率一起生效時，是先加秒數再乘倍率', () => {
  const clock = TT2_ARTIFACTS.findIndex(a => a.effect === 'AllActiveSkillDuration');
  const s = hydrate(fresh(1000));
  s.tt2.artifacts[clock] = 40;
  s.tt2.sets = [hunter];
  const seconds = stateEffect(s, 'AllActiveSkillDuration');
  const mult = 1 + stateEffect(s, 'AllActiveSkillDurationMult');
  for (let i = 0; i < SKILL_DATA.length; i++) {
    const expected = (SKILLS[i].duration + seconds) * mult;
    assert.ok(Math.abs(skillDuration(s, i) - expected) < 1e-9 * expected,
      `${SKILL_DATA[i].id} 應該是 (${SKILLS[i].duration} + ${seconds}) × ${mult}`);
  }
});

test('倍率那一組是加法型，所以疊加而不是相乘', () => {
  for (const id of ['AllActiveSkillDuration', 'AllActiveSkillDurationMult']) {
    assert.equal(bonusDefinitions[id].additive, true, `${id} 應該是加法型`);
  }
});

test('天堂聖擊沒有自己的持續加成，兩個後綴都跳過而不是拿到中性值', () => {
  const skipped = new Set(coverage.generatedFrom.skippedCombinations);
  assert.ok(skipped.has('BurstDamageSkillDuration'));
  assert.ok(skipped.has('BurstDamageSkillDurationMult'));
  const s = hydrate(fresh(1000));
  const burst = SKILL_DATA.findIndex(k => k.id === 'BurstDamage');
  assert.equal(skillDuration(s, burst), SKILLS[burst].duration, '瞬發技能的持續時間仍是基礎值');
});
