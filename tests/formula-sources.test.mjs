import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COVERED, exportsOf, loadRegister, validate } from '../tools/formula-sources.mjs';

const register = loadRegister();
const report = validate(register);
const readable = readFileSync(new URL('../docs/formula-sources.md', import.meta.url), 'utf8');

test('every core formula names a source, and every source it names exists', () => {
  assert.deepEqual(report.problems, []);
  assert.equal(report.formulas, 29);
  assert.equal(report.parts, 52);
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
    'table-differs': 1, 'baseline-75': 6, invented: 9, table: 16, default: 2, server: 13, native: 5,
  });
  // Over a third of the sources are still the 7.5 baseline or this project's own choice.
  const unverified = report.counts['baseline-75'] + report.counts.invented + report.counts.server;
  assert.equal(unverified, 28);
  assert.ok(unverified / report.parts > 0.5, '待核實比例應如實記錄');
});

test('the one place the package disagrees with the engine is written down', () => {
  const differs = register.formulas.flatMap(formula =>
    formula.parts.filter(part => part.status === 'table-differs').map(part => ({ formula, part })));
  assert.equal(differs.length, 1);
  assert.equal(differs[0].formula.id, 'monsterHealth');
  // The boss multiplier sequence is banded by stage in the package; the engine uses one band.
  assert.match(differs[0].part.note, /4,6,8,15,24/);
  assert.match(differs[0].part.note, /ServerVar/);
  assert.equal(differs[0].part.ref, 'TitanScalingInfo.json');
});

test('the readable copy matches the register it was rendered from', () => {
  assert.match(readable, /共 29 條公式、52 項來源條目/);
  for (const formula of register.formulas) assert.ok(readable.includes(formula.id), formula.id);
  for (const status of Object.keys(register.statuses)) assert.ok(readable.includes(`\`${status}\``), status);
});
