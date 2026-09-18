import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { fresh, hydrate, apply, skillCap, skillPower, stateEffect, SKILL_DATA, SKILLS } from '../lib/engine.ts';
import { TT2_SETS, bonusDefinitions } from '../lib/tt2-rules.ts';
import { fromNumber } from '../lib/big-number.ts';

const evidence = JSON.parse(readFileSync(new URL('skill-cap-evidence.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));
const darkAngel = TT2_SETS.findIndex(s => s.id === 'DarkAngel');

function ready(sets = []) {
  const s = hydrate(fresh(1000));
  s.level = 600; s.best = 2000; s.gold = fromNumber(1e60);
  s.tt2.sets = sets;
  return s;
}

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
});

test('原生的上限是預設值加上各種 Cap 加成', () => {
  assert.equal(evidence.bonusesRead[0], 'AllActiveSkillCap');
  assert.match(evidence.expression, /defaultSkillCap \+ AllActiveSkillCap/);
  assert.equal(bonusDefinitions.AllActiveSkillCap.additive, true);
});

test('職業專屬的上限在本專案沒有來源，所以刻意不接', () => {
  for (const id of evidence.classCapsNotConnected) {
    const granted = JSON.stringify([...TT2_SETS]).includes(`"${id}"`);
    assert.ok(!granted, `${id} 一旦有來源，就要照原生把它加進上限`);
  }
});

test('沒有套裝時上限是資料表的預設值', () => {
  const s = ready();
  assert.equal(stateEffect(s, 'AllActiveSkillCap'), 0);
  for (let i = 0; i < SKILL_DATA.length; i++) assert.equal(skillCap(s, i), SKILL_DATA[i].max);
});

test('暗黑天使套裝把六個技能的上限一起拉高', () => {
  const s = ready([darkAngel]);
  const raise = stateEffect(s, 'AllActiveSkillCap');
  assert.ok(raise > 0, '湊齊套裝應該真的提高上限');
  for (let i = 0; i < SKILL_DATA.length; i++) assert.equal(skillCap(s, i), SKILL_DATA[i].max + raise);
});

test('上限拉高之後買得到，而且那幾級是真的有內容', () => {
  const s = ready([darkAngel]);
  s.skillLevels = s.skillLevels.map(() => SKILL_DATA[0].max);
  const before = skillPower(s, 0);
  apply(s, { type: 'skillUp', index: 0, at: s.last });
  assert.equal(s.skillLevels[0], SKILL_DATA[0].max + 1, '超過預設上限一級應該買得下去');
  assert.ok(skillPower(s, 0) > before * 2, '資料表上面那幾列是真的內容，不是重複最後一格');
});

test('沒有套裝就買不過預設上限', () => {
  const s = ready();
  s.skillLevels = s.skillLevels.map(() => SKILL_DATA[0].max);
  apply(s, { type: 'skillUp', index: 0, at: s.last });
  assert.equal(s.skillLevels[0], SKILL_DATA[0].max, '沒有加成時不該買得過去');
});

test('合法買到的等級在載入時不會被夾回預設上限', () => {
  const s = ready([darkAngel]);
  s.skillLevels = s.skillLevels.map((_, i) => skillCap(s, i));
  const bought = [...s.skillLevels];
  const reloaded = hydrate(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(reloaded.skillLevels, bought, '夾擠要跟著動態上限走');
});

test('上限不會超出資料表的列數', () => {
  const s = ready([darkAngel]);
  for (let i = 0; i < SKILL_DATA.length; i++) {
    assert.ok(skillCap(s, i) <= SKILL_DATA[i].amount.length, '超出表格會讀到 undefined');
    assert.ok(Number.isFinite(skillPower(s, i)), `${SKILLS[i].name} 在上限等級仍要是有限值`);
  }
});
