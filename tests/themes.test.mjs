import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TT2_THEMES, THEME_STAGES, themeIndex, themeStageRange } from '../lib/tt2-themes.ts';
import { SOURCE_NAMES } from '../lib/tt2-source-names.ts';
import { referenceRoot } from '../tools/reference-validation.mjs';

const backgrounds = JSON.parse(readFileSync(new URL('BackgroundInfo.json', referenceRoot), 'utf8')).records
  .map(row => ({ stage: Number(row.id), theme: row.values.Theme }))
  .sort((a, b) => a.stage - b.stage);

test('the theme list matches the order and cadence the package records', () => {
  const order = [];
  for (const row of backgrounds) if (!order.includes(row.theme)) order.push(row.theme);
  assert.deepEqual(TT2_THEMES.map(theme => theme.id), order);
  assert.equal(TT2_THEMES.length, 14);
  // Every theme covers exactly five stages in the bundled sheet.
  const counts = {};
  for (const row of backgrounds) counts[row.theme] = (counts[row.theme] ?? 0) + 1;
  assert.ok(Object.values(counts).every(count => count === THEME_STAGES));
  assert.equal(backgrounds.length, TT2_THEMES.length * THEME_STAGES);
  assert.equal(backgrounds.length, 70);
});

test('every stage in the package maps to the theme the package gives it', () => {
  for (const row of backgrounds) {
    assert.equal(TT2_THEMES[themeIndex(row.stage)].id, row.theme, `關卡 ${row.stage}`);
  }
  // Past the bundled range the cycle repeats rather than running out.
  assert.equal(themeIndex(71), themeIndex(1));
  assert.equal(themeIndex(140), themeIndex(70));
  for (const stage of [0, -5, 1.7, 1e6]) assert.ok(Number.isInteger(themeIndex(stage)), String(stage));
});

test('the map list shows the stage range of the cycle the player is in', () => {
  assert.deepEqual(themeStageRange(0, 1), { first: 1, last: 5 });
  assert.deepEqual(themeStageRange(13, 1), { first: 66, last: 70 });
  // A player past the first cycle sees the ranges of their own cycle.
  assert.deepEqual(themeStageRange(0, 71), { first: 71, last: 75 });
  assert.deepEqual(themeStageRange(13, 140), { first: 136, last: 140 });
  for (const stage of [1, 33, 70, 71, 999]) {
    const index = themeIndex(stage);
    const { first, last } = themeStageRange(index, stage);
    assert.ok(stage >= first && stage <= last, `關卡 ${stage} 應落在 ${first}—${last}`);
  }
});

test('theme names are the official Traditional Chinese ones, not invented labels', () => {
  // The same import路徑 as every other official name this project ships.
  for (const theme of TT2_THEMES) {
    assert.equal(SOURCE_NAMES[`BACKGROUND_NAME_${theme.id}`], theme.name, theme.id);
  }
  assert.equal(new Set(TT2_THEMES.map(theme => theme.name)).size, TT2_THEMES.length);
});
