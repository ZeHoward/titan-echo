import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EFFECT_LABELS } from '../lib/tt2-rules.ts';
import { OFFICIAL_BONUS_LABELS } from '../lib/tt2-bonus-labels.ts';
import { referenceRoot } from '../tools/reference-validation.mjs';

const parity = JSON.parse(readFileSync(new URL('bonus-label-parity.json', referenceRoot), 'utf8'));

test('every effect the interface labels has the package name recorded beside it', () => {
  assert.equal(Object.keys(EFFECT_LABELS).length, 103);
  assert.equal(Object.keys(OFFICIAL_BONUS_LABELS).length, 103);
  for (const key of Object.keys(EFFECT_LABELS)) {
    assert.ok(OFFICIAL_BONUS_LABELS[key], `${key} 缺少官方字串`);
    assert.ok(!/[A-Za-z{}<>]/.test(OFFICIAL_BONUS_LABELS[key]), `${key} 官方字串含非中文字元`);
  }
  assert.deepEqual(parity.withoutOfficialString, []);
  assert.deepEqual(parity.unusableOfficialStrings, []);
  assert.equal(parity.withOfficialString, 103);
});

test('the disagreement is recorded rather than quietly resolved', () => {
  assert.equal(parity.differingFromProject, 90);
  assert.equal(parity.differing.length, 90);
  for (const row of parity.differing) {
    assert.equal(row.project, EFFECT_LABELS[row.id], row.id);
    assert.equal(row.official, OFFICIAL_BONUS_LABELS[row.id], row.id);
    assert.notEqual(row.project, row.official, row.id);
  }
  // The thirteen that already agree need no decision at all.
  const agreeing = Object.keys(EFFECT_LABELS).filter(key => EFFECT_LABELS[key] === OFFICIAL_BONUS_LABELS[key]);
  assert.equal(agreeing.length, 13);
});

test('two glossary terms are used in opposite directions inside the same file', () => {
  const blocked = parity.glossary.filter(row => row.blocksAdoption);
  assert.deepEqual(blocked.map(row => row.projectTerm), ['聖物', '妖精']);
  // 聖物 wins outside the bonus strings but loses inside them, and 妖精 the other way round.
  const relic = parity.glossary.find(row => row.projectTerm === '聖物');
  assert.ok(relic.inOtherStrings.kept > relic.inOtherStrings.alternative);
  assert.ok(relic.inBonusStrings.kept < relic.inBonusStrings.alternative);
  const fairy = parity.glossary.find(row => row.projectTerm === '妖精');
  assert.ok(fairy.inOtherStrings.kept < fairy.inOtherStrings.alternative);
  assert.ok(fairy.inBonusStrings.kept > fairy.inBonusStrings.alternative);
  assert.match(parity.decision, /維持本專案既有用語/);
});

test('the interface still shows this project\u0027s own wording', () => {
  // Importing the package names is a comparison, not a switch-over.
  assert.equal(EFFECT_LABELS.PrestigeRelic, '蛻變聖物');
  assert.equal(OFFICIAL_BONUS_LABELS.PrestigeRelic, '聲望遺物');
  const source = readFileSync(new URL('../lib/tt2-rules.ts', import.meta.url), 'utf8');
  assert.ok(!source.includes('OFFICIAL_BONUS_LABELS'), '效果標籤不應改讀官方字串');
});
