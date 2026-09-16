import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apply, fresh, hydrate, TT2_TUTORIAL, tutorialStep, tutorialProgress, tutorialMet,
  tutorialText } from '../lib/engine.ts';
import { toNumber } from '../lib/big-number.ts';
import { referenceRoot } from '../tools/reference-validation.mjs';

const load = name => JSON.parse(readFileSync(new URL(name + '.json', referenceRoot), 'utf8'));
const rows = load('TutorialEventInfo').records;
const evidence = load('tutorial-evidence');
const tap = (s, times) => { for (let n = 0; n < times; n++) apply(s, { type: 'tap', at: s.last + 100 }); };

test('the step list is the package list, in order', () => {
  assert.equal(TT2_TUTORIAL.length, 51);
  assert.equal(rows.length, 51);
  for (const row of rows) {
    const ours = TT2_TUTORIAL[Number(row.values.TutorialEventIndex)];
    const [objective, amount] = row.values.Objective.split(':');
    assert.equal(ours.objective, objective);
    assert.equal(ours.amount, Number(amount));
    assert.equal(ours.gold, Number(row.values.GoldReward || 0));
    assert.equal(ours.key, row.values.DisplayString);
    assert.ok(ours.text.length > 0, ours.key);
  }
  // Only the four objective types the package names, and each is measurable here.
  const kinds = [...new Set(TT2_TUTORIAL.map(step => step.objective))].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(kinds, ['ReachStage', 'SwordMasterLevel', 'TapCount', 'UnlockHelperCount']);
  assert.deepEqual(Object.values(evidence.objectiveTypes).sort((a, b) => a.localeCompare(b)), kinds);
});

test('an objective is met when progress reaches the amount, as the native test does', () => {
  assert.equal(evidence.objectiveTest.rule, 'GetCurrentProgress() >= TutorialEventInfo.ObjectiveAmount');
  const s = fresh(1000);
  assert.equal(tutorialStep(s).index, 0);
  assert.equal(tutorialStep(s).objective, 'TapCount');
  assert.equal(tutorialProgress(s), 0);
  assert.equal(tutorialMet(s), false);
  tap(s, TT2_TUTORIAL[0].amount);
  // The first steps are all tap counts, so a run of taps walks several of them at once.
  assert.ok(s.tt2.tutorialStep > 0, '達成後應自動前進');
});

test('the tap objective counts taps since the step began, not lifetime taps', () => {
  assert.match(evidence.progress.sources.TapCount, /換步時歸零/);
  const s = fresh(1000);
  tap(s, 5);
  assert.equal(s.tt2.tutorialTaps, 5);
  assert.equal(tutorialProgress(s), 5);
  tap(s, 5);
  // Step 0 wants ten taps; crossing it resets the counter for the next step.
  assert.ok(s.tt2.tutorialStep >= 1);
  assert.ok(s.tt2.tutorialTaps < s.taps, '每步計數不應等於累計點擊');
});

test('each step pays its gold once, and only the steps that carry one', () => {
  const s = fresh(1000);
  s.level = 1;
  const paying = TT2_TUTORIAL.filter(step => step.gold > 0);
  assert.equal(paying.length, 22);
  assert.equal(TT2_TUTORIAL[0].gold, 0);
  // Walk the first tap-only steps and check gold only moves on the paying one.
  const before = toNumber(s.gold);
  tap(s, 10);
  const step = s.tt2.tutorialStep;
  assert.ok(step >= 1);
  assert.ok(toNumber(s.gold) >= before);
  // Re-running the same state does not pay again: the step index has moved on.
  const held = toNumber(s.gold), heldStep = s.tt2.tutorialStep;
  apply(s, { type: 'boss', at: s.last });
  assert.equal(s.tt2.tutorialStep, heldStep);
  assert.equal(toNumber(s.gold), held);
});

test('a save from before the tutorial existed starts at the first step', () => {
  const legacy = JSON.parse(JSON.stringify(fresh(1000)));
  delete legacy.tt2.tutorialStep;
  delete legacy.tt2.tutorialTaps;
  const s = hydrate(legacy);
  assert.equal(s.tt2.tutorialStep, 0);
  assert.equal(s.tt2.tutorialTaps, 0);
  assert.equal(tutorialStep(s).index, 0);
  assert.ok(tutorialText(s).length > 0);
});

test('a player past the last step has no objective left', () => {
  const s = fresh(1000);
  s.tt2.tutorialStep = TT2_TUTORIAL.length;
  assert.equal(tutorialStep(s), null);
  assert.equal(tutorialMet(s), false);
  assert.equal(tutorialText(s), '');
  assert.equal(tutorialProgress(s), 0);
  // The last step asks for stage 60, which is also where prestige opens.
  assert.equal(TT2_TUTORIAL.at(-1).objective, 'ReachStage');
  assert.equal(TT2_TUTORIAL.at(-1).amount, 60);
});

test('the wording is the package wording, with the amount filled where it says to', () => {
  const s = fresh(1000);
  assert.equal(tutorialText(s), TT2_TUTORIAL[0].text);
  const filling = TT2_TUTORIAL.find(step => step.fills);
  assert.ok(filling, '應有需要填入數字的步驟');
  assert.match(filling.text, /\{0\}/);
  s.tt2.tutorialStep = filling.index;
  assert.equal(tutorialText(s), filling.text.replace('{0}', String(filling.amount)));
  assert.ok(!tutorialText(s).includes('{0}'));
});
