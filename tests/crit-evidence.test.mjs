import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {critChance,fresh,critMultiplier,BONUS_DEFAULTS} from '../lib/engine.ts';
import { loadCatalogs, loadNativeServerVarFields, referenceRoot } from '../tools/reference-validation.mjs';
const load = name => JSON.parse(readFileSync(new URL(name + '.json', referenceRoot), 'utf8'));

test('the crit parameters exist natively as server vars, with no value in this package', () => {
  const fields = loadNativeServerVarFields();
  for (const field of ['playerCritChance', 'playerCritMult', 'maxCritChance', 'helperCanCrit']) {
    assert.ok(fields.has(field), field);
  }
  // Neither bundled sheet supplies any of them, so the live values are not in the package.
  const catalogs = loadCatalogs();
  const keys = new Set([...catalogs.ServerVarsInfo.records, ...catalogs.ServerVarOverride.records].map(r => r.id));
  for (const field of ['playerCritChance', 'playerCritMult', 'maxCritChance', 'helperCanCrit']) {
    assert.ok(!keys.has(field), `${field} 不應出現在安裝包的伺服器變數表`);
  }
  const evidence = load('servervars-parser-evidence').critParameters;
  assert.deepEqual(evidence.serverVarFields,
    ['playerCritChance', 'playerCritMult', 'maxCritChance', 'helperCanCrit']);
  assert.match(evidence.bundledValues, /^none:/);
  assert.match(evidence.limits, /server-supplied and not in this package/);
});

test('only one crit parameter has a native default, and it is off', () => {
  const evidence = load('servervars-parser-evidence').critParameters.nativeDefault;
  assert.equal(evidence.field, 'helperCanCrit');
  assert.equal(evidence.value, false);
  assert.equal(evidence.instructionRva, '0x24aafc0');
  // The instruction itself is re-checked by tools/audit-servervars-parser.py against the pinned binary.
  assert.match(evidence.note, /static constructor/);
});

test('暴擊的三個數字現在都有原生依據，不再是本專案自訂', () => {
  // This test used to assert the opposite: base 2% and a fixed x10 were engine choices with no
  // package backing. That was only true of the bundled tables — the compiled-in defaults have them.
  const state = fresh(1000);
  const bonuses = load('bonus-defaults-evidence').defaults;
  assert.equal(BONUS_DEFAULTS.critChance, Math.fround(bonuses.CritChance.value));
  assert.equal(bonuses.CritChance.field, 'playerCritChance');
  assert.equal(critChance(state), BONUS_DEFAULTS.critChance);
  const defaults = load('servervar-defaults').recovered;
  assert.equal(critMultiplier(state), defaults.playerCritMult.value);
  assert.equal(defaults.maxCritChance.value, 1);
  // The tap used to multiply by a hard-coded 10 instead of the multiplier it already exported.
  const source = readFileSync(new URL('../lib/engine.ts', import.meta.url), 'utf8');
  assert.ok(!source.includes('t.lastCrit?10:1'), '暴擊倍率仍為硬編 10 倍');
  assert.ok(source.includes('t.lastCrit?critMultiplier(s):1'), '點擊沒有用暴擊倍率');
  // Still not parity: these are compiled-in defaults, and the live server can replace them.
  const evidence = load('servervars-parser-evidence').critParameters;
  assert.match(evidence.bundledValues, /neither ServerVarsInfo nor ServerVarOverride/);
});
