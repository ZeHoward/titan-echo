import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { loadRegister } from '../tools/formula-sources.mjs';
import { fresh, monsterCount, isBoss } from '../lib/engine.ts';

const evidence = JSON.parse(readFileSync(new URL('monster-count-evidence.json', referenceRoot), 'utf8'));
const defaults = JSON.parse(readFileSync(new URL('servervar-defaults.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../app/game.tsx', import.meta.url), 'utf8');

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
});

test('算式的三個參數就是那三個 [ServerVar] 的編譯期預設值', () => {
  assert.deepEqual(evidence.readsInOrder,
    ['monsterCountInc', 'monsterCountStageDelta', 'monsterCountBase']);
  assert.equal(evidence.defaults.monsterCountBase.value, 8);
  assert.equal(evidence.defaults.monsterCountInc.value, 148);
  assert.equal(evidence.defaults.monsterCountStageDelta.value, 32000);
  // The same numbers the whole-block walk recovered, so the two records cannot drift apart.
  for (const name of Object.keys(evidence.defaults)) {
    assert.equal(evidence.defaults[name].value, defaults.recovered[name].value, name);
  }
});

test('引擎每一關算出的隻數，與證據的樣本逐關相同', () => {
  const s = fresh(1000);
  for (const [stage, expected] of Object.entries(evidence.sampleCounts)) {
    s.stage = Number(stage);
    assert.equal(monsterCount(s), expected, `第 ${stage} 關`);
  }
  // The shape that matters: eight early on, and many more at the cap — not a flat ten.
  s.stage = 1;
  assert.equal(monsterCount(s), 8);
  s.stage = 98000;
  assert.equal(monsterCount(s), 120);
});

test('隻數改變時頭目的判定跟著改變', () => {
  const s = fresh(1000);
  s.stage = 1;
  s.kills = monsterCount(s) - 1;
  assert.equal(isBoss(s), false);
  s.kills = monsterCount(s);
  assert.equal(isBoss(s), true);
  // A save written when the stage held ten is still consistent: more kills than needed is a boss.
  s.stage = 1; s.kills = 10;
  assert.equal(isBoss(s), true);
});

test('隻數多到畫不下時，介面改用進度條而不是畫一百二十個點', () => {
  assert.match(source, /const WAVE_DOT_LIMIT=12;/);
  assert.match(source, /function WaveProgress\(/);
  assert.match(source, /wave-bar/);
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.wave-bar{'), '缺少 .wave-bar 樣式');
});

test('登記為原生靜態預設值，並寫明線上可覆蓋', () => {
  const register = loadRegister();
  const formula = register.formulas.find(f => f.id === 'monsterCount');
  assert.equal(formula.parts.length, 1);
  assert.equal(formula.parts[0].status, 'default');
  assert.equal(formula.parts[0].ref, 'monster-count-evidence.json');
  assert.match(formula.expression, /32000/);
});
