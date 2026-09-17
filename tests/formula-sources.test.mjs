import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COVERED, exportsOf, loadRegister, validate } from '../tools/formula-sources.mjs';

const register = loadRegister();
const report = validate(register);
const readable = readFileSync(new URL('../docs/formula-sources.md', import.meta.url), 'utf8');

test('every core formula names a source, and every source it names exists', () => {
  assert.deepEqual(report.problems, []);
  assert.equal(report.formulas, 30);
  assert.equal(report.parts, 56);
});

test('no export in a covered module escapes classification', () => {
  // The point of the register: a formula cannot be added or renamed without being classified.
  const registered = new Set(register.formulas.map(formula => formula.export));
  const classified = new Set(Object.values(register.notFormulas).flat());
  for (const module of COVERED) {
    for (const name of exportsOf(module)) {
      assert.ok(registered.has(name) || classified.has(name), `${module}#${name} 未歸類`);
    }
  }
  assert.ok(COVERED.includes('lib/engine.ts'));
  assert.equal(new Set(Object.values(register.notFormulas).flat()).size,
    Object.values(register.notFormulas).flat().length, '非公式清單有重複');
});

test('the counts are recorded, so a source changing status is a visible change', () => {
  assert.deepEqual(report.counts, {
    'table-differs': 2, 'baseline-75': 5, invented: 11, table: 16, default: 2, server: 14, native: 6,
  });
  // Over a third of the sources are still the 7.5 baseline or this project's own choice.
  const unverified = report.counts['baseline-75'] + report.counts.invented + report.counts.server;
  assert.equal(unverified, 30);
  assert.ok(unverified / report.parts > 0.5, '待核實比例應如實記錄');
});

test('每一處與安裝包不一致的地方都寫下來了', () => {
  const differs = register.formulas.flatMap(formula =>
    formula.parts.filter(part => part.status === 'table-differs').map(part => ({ formula, part })));
  assert.equal(differs.length, 2);
  const boss = differs.find(entry => entry.formula.id === 'monsterHealth');
  // The boss multiplier sequence is banded by stage in the package; the engine uses one band.
  assert.match(boss.part.note, /4,6,8,15,24/);
  assert.match(boss.part.note, /ServerVar/);
  assert.equal(boss.part.ref, 'TitanScalingInfo.json');
  const growth = differs.find(entry => entry.formula.id === 'heroDamage');
  // The native hero curve is the milestone table alone; the engine adds a 7.5-era growth rate.
  assert.match(growth.part.note, /GetRawDPS/);
  assert.equal(growth.part.ref, 'hero-dps-evidence.json');
});

test('the readable copy matches the register it was rendered from', () => {
  assert.match(readable, /共 30 條公式、56 項來源條目/);
  for (const formula of register.formulas) assert.ok(readable.includes(formula.id), formula.id);
  for (const status of Object.keys(register.statuses)) assert.ok(readable.includes(`\`${status}\``), status);
});
