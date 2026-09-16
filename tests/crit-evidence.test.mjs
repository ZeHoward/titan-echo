import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { critChance, fresh } from '../lib/engine.ts';
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

test('the numbers the engine uses today are its own, not values taken from the package', () => {
  const state = fresh(1000);
  // Base chance 2% and a fixed ten times multiplier are engine choices with no package backing.
  assert.equal(critChance(state), 0.02);
  const source = readFileSync(new URL('../lib/engine.ts', import.meta.url), 'utf8');
  assert.ok(source.includes("Math.min(1,.02+stateEffect(s,'CritChance'))"), '暴擊機率仍為硬編 2%');
  assert.ok(source.includes('t.lastCrit?10:1'), '暴擊倍率仍為硬編 10 倍');
  // C01 cannot claim parity until the live crit values are obtained from outside the package.
  const evidence = load('servervars-parser-evidence').critParameters;
  assert.match(evidence.bundledValues, /neither ServerVarsInfo nor ServerVarOverride/);
});
