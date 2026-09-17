import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { loadRegister } from '../tools/formula-sources.mjs';
import { fresh, apply, relicGain, PRESTIGE_DEFAULTS } from '../lib/engine.ts';

const evidence = JSON.parse(readFileSync(new URL('prestige-unlock-evidence.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
  assert.match(evidence.binarySha256, /^[0-9a-f]{64}$/);
});

test('第 60 關就是 [ServerVar] minimumPrestigeStage 的編譯期預設值', () => {
  assert.equal(evidence.threshold.field, 'ServerVarsModel.minimumPrestigeStage');
  assert.equal(evidence.threshold.value, 60);
  assert.equal(PRESTIGE_DEFAULTS.minimumStage, evidence.threshold.value);
  // It is the floor of the requirement, not some unrelated field with the same number: the
  // evidence records it as the second argument of the Math.Max that GetPrestigeStage ends on.
  assert.match(evidence.threshold.role, /Math\.Max/);
  assert.match(evidence.finding, /GetPrestigeStage/);
});

test('三個讀取點都記下來了，找法是指令編碼而不是名字', () => {
  assert.equal(evidence.threshold.readers.length, 3);
  assert.ok(evidence.threshold.readers.some(reader => reader.method === 'PrestigeModel$$GetPrestigeStage'));
  for (const reader of evidence.threshold.readers) assert.match(reader.at, /^0x[0-9a-f]+$/);
  assert.match(evidence.finding, /0xbec/);
});

test('引擎三處共用那個常數，門檻之下不給聖物也不能蛻變', () => {
  const below = fresh(1000);
  below.best = PRESTIGE_DEFAULTS.minimumStage - 1;
  below.stage = below.best;
  assert.equal(relicGain(below), 0, '門檻之下一顆都沒有');
  const unchanged = apply(below, { type: 'prestige', at: 1000 });
  assert.equal(unchanged.prestiges, 0, '門檻之下按蛻變不會有事發生');
  const at = fresh(1000);
  at.best = PRESTIGE_DEFAULTS.minimumStage;
  at.stage = at.best;
  assert.ok(relicGain(at) >= 1, '到門檻就至少一顆');
  const prestiged = apply(at, { type: 'prestige', at: 1000 });
  assert.equal(prestiged.prestiges, 1);
});

test('原生在門檻之上還有一層乘數，本專案沒做，理由寫下來了', () => {
  const percent = evidence.notImplemented.percentRequirement;
  assert.equal(percent.field, 'ServerVarsModel.prestigeMsPercentRequirement');
  assert.equal(percent.value, Math.fround(0.5));
  assert.match(percent.formula, /minimumPrestigeStage/);
  assert.match(percent.note, /歷史最高的一半/);
  // The engine keeps prestige available once the threshold is passed; that is the difference.
  const far = fresh(1000);
  far.best = 5000;
  far.stage = 1;
  assert.ok(relicGain(far) >= 1, '引擎不管目前關卡離歷史最高多遠');
});

test('登記表把第 60 關升為 default，把那一層列為不一致', () => {
  const register = loadRegister();
  const relics = register.formulas.find(formula => formula.id === 'prestigeRelics');
  const threshold = relics.parts.find(part => part.part.includes('第 60 關'));
  assert.equal(threshold.status, 'default');
  assert.equal(threshold.ref, 'prestige-unlock-evidence.json');
  const layer = relics.parts.find(part => part.part.includes('歷史最高關卡'));
  assert.equal(layer.status, 'table-differs');
  assert.match(layer.note, /待決定/);
  // The whole point of this pass: no source is left sitting on the 7.5 baseline.
  const remaining = register.formulas.flatMap(formula =>
    formula.parts.filter(part => part.status === 'baseline-75'));
  assert.deepEqual(remaining, [], '沿用 7.5 的條目已經全部查完');
  assert.equal(evidence.limits.length, 5);
});
