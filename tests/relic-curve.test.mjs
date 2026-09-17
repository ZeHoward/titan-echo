import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { loadRegister } from '../tools/formula-sources.mjs';
import { fresh, relicGain, PRESTIGE_DEFAULTS } from '../lib/engine.ts';
import { TT2_SETS } from '../lib/tt2-data.ts';

const evidence = JSON.parse(readFileSync(new URL('relic-curve-evidence.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));
const value = name => evidence.coefficients[name].value;

/** The native curve, rebuilt here from the published coefficients rather than copied. */
const native = stage => {
  const clamped = Math.min(stage, value('relicsStageMax'));
  const linear = value('relicStageMult2') * (value('relicStageOffset') + clamped);
  const powerOfBase = value('relicStageMult1')
    * value('relicStageBase') ** (clamped ** value('relicStageExpo'));
  const exponent = Math.min(value('relicStageExpoMax3'),
    value('relicStageExpo2') * (1 + value('relicStageMult3') * clamped ** value('relicStageExpo3')));
  const powerOfBase2 = value('relicStageBase2') ** (clamped ** exponent);
  return { total: Math.max(0, linear + powerOfBase + powerOfBase2), exponent };
};

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
  assert.match(evidence.binarySha256, /^[0-9a-f]{64}$/);
});

test('十個係數都有編譯期預設值，第三段的兩個也在', () => {
  const expected = {
    relicStageMult1: 3, relicStageMult2: 1.5, relicStageMult3: 5e-7,
    relicStageBase: 1.21, relicStageBase2: 1.002, relicStageExpo: 0.48,
    relicStageExpo2: 1.005, relicStageExpo3: 1.1, relicStageExpoMax3: 1.0155,
    relicStageOffset: -56, relicsStageMax: 180000,
  };
  for (const [name, wanted] of Object.entries(expected)) {
    assert.equal(value(name), wanted, name);
    assert.match(evidence.coefficients[name].offset, /^0x[0-9a-f]+$/);
  }
  // The two that the earlier pass never reached are the third term's exponent and its ceiling.
  assert.ok(evidence.readOrder.includes('relicStageExpo3'));
  assert.ok(evidence.readOrder.includes('relicStageExpoMax3'));
  assert.equal(evidence.readOrder[0], 'relicsStageMax', '關卡先被夾住才進曲線');
});

test('三段的算式重算得出證據裡的每一個樣本', () => {
  for (const [stage, row] of Object.entries(evidence.comparison)) {
    const { total, exponent } = native(Number(stage));
    // Relative comparison: the numbers run past 1e100 at the top of the range.
    assert.ok(Math.abs(total / row.native - 1) < 1e-9, `第 ${stage} 關的總和`);
    assert.ok(Math.abs(exponent / row.thirdExponent - 1) < 1e-12, `第 ${stage} 關的第三段指數`);
    const sum = row.terms.linear + row.terms.powerOfBase + row.terms.powerOfBase2;
    assert.ok(Math.abs(sum / row.native - 1) < 1e-9, `第 ${stage} 關的三段相加`);
  }
});

test('第三段的指數會頂到上限，之後兩條曲線失去可比性', () => {
  const ceiling = value('relicStageExpoMax3');
  // Below the ceiling the exponent still climbs with the stage.
  assert.ok(native(1000).exponent < ceiling);
  assert.ok(native(1000).exponent > native(100).exponent);
  // At and past it the exponent is pinned, and the term becomes 1.002^(stage^1.0155).
  assert.equal(native(10000).exponent, ceiling);
  assert.equal(native(98000).exponent, ceiling);
  assert.ok(evidence.comparison['10000'].exponentAtCeiling);
  assert.ok(!evidence.comparison['2000'].exponentAtCeiling);
  // Same order of magnitude early, hopeless later — that is why it is not adopted.
  assert.ok(evidence.comparison['1000'].ratio < 4);
  assert.ok(evidence.comparison['98000'].ratio > 1e90);
});

test('引擎目前的近似值就是證據裡記的那一欄', () => {
  const s = fresh(1000);
  s.best = Math.max(PRESTIGE_DEFAULTS.minimumStage, 1);
  for (const [stage, row] of Object.entries(evidence.comparison)) {
    s.stage = Number(stage);
    s.best = Math.max(s.best, s.stage);
    assert.equal(relicGain(s), row.engine, `第 ${stage} 關`);
  }
});

test('外層四個乘數的結合順序定下來了，兩個已接上引擎', () => {
  assert.deepEqual(evidence.outer.multipliers,
    ['PrestigeRelic', 'PrestigeRelicAdditive', 'OnlyPrestigeRelic']);
  assert.equal(evidence.outer.rounding, 'GHDouble.Ceiling');
  assert.match(evidence.outer.formula, /Bonus\(PrestigeRelic\) × \(1 \+ Bonus\(PrestigeRelicAdditive\)\)/);
  // The call order is what makes the association readable, so it is pinned whole.
  assert.equal(evidence.outer.callOrder.at(-1), 'GHDouble$$Ceiling');
  assert.equal(evidence.outer.callOrder.filter(name => name === 'GHDouble$$op_Multiply').length, 4);
  assert.equal(evidence.outer.callOrder.filter(name => name === 'BonusModel$$GetBonus').length, 3);
  // Two of the four are now in the engine; the additive-multiplier term is not.
  assert.match(evidence.engineFormula, /PrestigeRelicAdditive/);
  assert.match(evidence.engineFormula, /OnlyPrestigeRelic/);
  assert.match(evidence.adopted.notAdopted, /累加倍率/);
  assert.equal(evidence.outer.additiveTerm.coefficient.value, Math.fround(0.00017));
});

test('接上的兩個乘數在乾淨存檔沒有作用，湊齊套裝才變多', () => {
  const clean = fresh(1000);
  clean.best = 1000;
  clean.stage = 1000;
  assert.equal(relicGain(clean), evidence.comparison['1000'].engine, '乾淨存檔與接上前相同');
  // One mythic set grants PrestigeRelicAdditive 2.4408, so 1 + that is the whole difference.
  const withSet = fresh(1000);
  withSet.best = 1000;
  withSet.stage = 1000;
  const index = TT2_SETS.findIndex(set => set.id === 'ScrollTutor');
  const granted = TT2_SETS[index].effects
    .find(effect => effect.type === 'PrestigeRelicAdditive').amount;
  withSet.tt2.sets = [index];
  const ratio = relicGain(withSet) / relicGain(clean);
  assert.ok(Math.abs(ratio - (1 + granted)) < 0.01, `倍率 ${ratio}，預期 ${1 + granted}`);
});

test('登記表記錄算式已讀完、順序已照做、剩下兩處不一致', () => {
  const register = loadRegister();
  const relics = register.formulas.find(formula => formula.id === 'prestigeRelics');
  const curve = relics.parts.find(part => part.part.includes('指數 1.7'));
  assert.equal(curve.status, 'table-differs');
  assert.equal(curve.ref, 'relic-curve-evidence.json');
  assert.match(curve.note, /完整讀完/);
  assert.match(curve.note, /第 9 條/);
  const order = relics.parts.find(entry => entry.part === '外層乘數的結合順序');
  assert.equal(order.status, 'native', '順序是反組譯確認的，而且引擎已照做');
  for (const key of ['累加倍率那一項未實作', '進位方向']) {
    const part = relics.parts.find(entry => entry.part === key);
    assert.ok(part, key);
    assert.equal(part.status, 'table-differs');
  }
  // The old note said only two of the relic server vars carried a value. That was true of the
  // variable table, not of the compiled-in defaults; the corrected count is recorded instead.
  const extra = relics.parts.find(part => part.part.includes('額外的聖物乘數'));
  assert.equal(extra.status, 'table-differs');
  assert.match(extra.note, /28 個有值/);
  assert.match(extra.note, /50000/);
  assert.equal(evidence.limits.length, 4);
});
