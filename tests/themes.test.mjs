import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TT2_THEMES, THEME_STAGES, themeIndex, themeStageRange } from '../lib/tt2-themes.ts';
import { SOURCE_NAMES } from '../lib/tt2-source-names.ts';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { backgroundIndex, STAGE_LEVELS, themesInBand } from '../lib/tt2-stages.ts';

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

test('關卡的主題永遠等於背景規則選出的那一列', () => {
  // The first band walks levels 1..25 in order, so those stages do read straight off the sheet.
  for (const row of backgrounds.filter(entry => entry.stage <= 25)) {
    assert.equal(TT2_THEMES[themeIndex(row.stage)].id, row.theme, `關卡 ${row.stage}`);
  }
  // Everywhere else the band decides, and the theme has to follow the same level the monsters do.
  for (let stage = 1; stage <= 2000; stage += 1) {
    assert.equal(TT2_THEMES[themeIndex(stage)].id, STAGE_LEVELS[backgroundIndex(stage)].theme, `關卡 ${stage}`);
  }
  // A new band restarts the walk: stage 26 is the first zone again, not the twenty-sixth level.
  assert.equal(themeIndex(26), themeIndex(1));
  assert.equal(themeIndex(56), themeIndex(1));
  assert.equal(themeIndex(406), themeIndex(1));
  for (const stage of [0, -5, 1.7, 1e6]) assert.ok(Number.isInteger(themeIndex(stage)), String(stage));
});

test('地圖列出的是玩家目前這一段的關卡範圍，而且只列這一段到得了的區域', () => {
  assert.deepEqual(themeStageRange(0, 1), { first: 1, last: 5 });
  assert.deepEqual(themeStageRange(4, 1), { first: 21, last: 25 });
  // A band that restarts the walk restarts the ranges with it.
  assert.deepEqual(themeStageRange(0, 26), { first: 26, last: 30 });
  assert.deepEqual(themeStageRange(5, 26), { first: 51, last: 55 });
  assert.deepEqual(themeStageRange(0, 406), { first: 406, last: 410 });
  for (const stage of [1, 25, 26, 70, 406, 999]) {
    const index = themeIndex(stage);
    const { first, last } = themeStageRange(index, stage);
    assert.ok(stage >= first && stage <= last, `關卡 ${stage} 應落在 ${first}—${last}`);
    // The map never offers a zone the current band cannot reach.
    assert.ok(index < themesInBand(stage), `關卡 ${stage} 的主題 ${index} 不在這一段內`);
  }
  assert.equal(themesInBand(1), 5);
  assert.equal(themesInBand(406), TT2_THEMES.length);
});

test('theme names are the official Traditional Chinese ones, not invented labels', () => {
  // The same import路徑 as every other official name this project ships.
  for (const theme of TT2_THEMES) {
    assert.equal(SOURCE_NAMES[`BACKGROUND_NAME_${theme.id}`], theme.name, theme.id);
  }
  assert.equal(new Set(TT2_THEMES.map(theme => theme.name)).size, TT2_THEMES.length);
});
