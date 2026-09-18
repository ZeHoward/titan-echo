import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COVERED, exportsOf, loadRegister, validate } from '../tools/formula-sources.mjs';

const register = loadRegister();
const report = validate(register);
const readable = readFileSync(new URL('../docs/formula-sources.md', import.meta.url), 'utf8');

test('every core formula names a source, and every source it names exists', () => {
  assert.deepEqual(report.problems, []);
  assert.equal(report.formulas, 36);
  assert.equal(report.parts, 86);
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
    'table-differs': 12, invented: 10, table: 19, default: 16, server: 3, native: 26,
  });
  // Nothing is left on the 7.5 baseline: every source has been checked against 8.2, and what
  // could not be adopted is recorded as known-but-not-followed rather than as unchecked.
  assert.equal(report.counts['baseline-75'] ?? 0, 0, '沿用 7.5 的條目已經全部查完');
  // Still unverified: this project's own choice, or a server value with no compiled-in default.
  const unverified = (report.counts['baseline-75'] ?? 0) + report.counts.invented + report.counts.server;
  assert.equal(unverified, 13);
  assert.equal(report.counts['table-differs'], 12, '已知但未照做的項目要看得見');
});

test('每一處與安裝包不一致的地方都寫下來了', () => {
  const differs = register.formulas.flatMap(formula =>
    formula.parts.filter(part => part.status === 'table-differs').map(part => ({ formula, part })));
  assert.equal(differs.length, 12);
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
  assert.match(readable, /共 36 條公式、86 項來源條目/);
  for (const formula of register.formulas) assert.ok(readable.includes(formula.id), formula.id);
  for (const status of Object.keys(register.statuses)) assert.ok(readable.includes(`\`${status}\``), status);
});
