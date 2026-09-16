import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import {
  BACKGROUND_CYCLE, LEVELS_PER_THEME, MONSTER_IDS, SPRITE_COUNT, STAGE_LEVELS,
  backgroundIndex, bandStart, bossSprite, cycleIndex, monsterDiversity, monsterScale,
  pickMonsterSprite, spriteForMonster, stageBossId, stageLevel, stagePool, themeIndexFor, themesInBand,
} from '../lib/tt2-stages.ts';
import { TT2_THEMES, THEME_STAGES, themeIndex, themeStageRange } from '../lib/tt2-themes.ts';
import { fresh, hydrate, advance, monsterIndex, isBoss } from '../lib/engine.ts';

const load = name => JSON.parse(readFileSync(new URL(name + '.json', referenceRoot), 'utf8'));
const evidence = load('stage-monster-evidence');
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));

test('產生的資料與安裝包的兩張表逐格相同', () => {
  const rows = load('BackgroundInfo').records.sort((a, b) => Number(a.values.Level) - Number(b.values.Level));
  assert.equal(STAGE_LEVELS.length, rows.length);
  for (const [index, row] of rows.entries()) {
    const level = STAGE_LEVELS[index];
    assert.equal(level.level, Number(row.values.Level));
    assert.equal(level.theme, row.values.Theme);
    assert.equal(level.boss, row.values.Boss);
    assert.deepEqual(level.monsters, Array.from({ length: 10 }, (_, i) => row.values['Monster' + (i + 1)]));
  }
  const cycle = load('BackgroundCycleInfo').records.sort((a, b) => Number(a.values.Level) - Number(b.values.Level));
  assert.equal(BACKGROUND_CYCLE.length, cycle.length);
  for (const [index, row] of cycle.entries()) {
    assert.deepEqual(BACKGROUND_CYCLE[index], {
      level: Number(row.values.Level),
      themeEnd: Number(row.values.ThemeEnd),
      diversity: Number(row.values.MonsterDiversity),
      scale: Number(row.values.Scale),
    });
  }
});

test('證據取自釘住的那份安裝包，八個方法都還在', () => {
  assert.equal(evidence.packageSha256, baseline.package.sha256);
  assert.equal(Object.keys(evidence.methods).length, 8);
  for (const [name, fact] of Object.entries(evidence.methods)) {
    assert.match(fact.rva, /^0x[0-9a-f]+$/, name);
    assert.match(fact.bytesSha256, /^[0-9a-f]{64}$/, name);
    assert.ok(fact.rule.length > 10, name);
  }
});

test('關卡剛好等於段的鍵值時仍屬前一段，這是原生的取法', () => {
  // GetCycleIndex steps back on an exact match, so 25 closes the first band instead of opening the second.
  assert.equal(cycleIndex(1), 0);
  assert.equal(cycleIndex(24), 0);
  assert.equal(cycleIndex(25), 0);
  assert.equal(cycleIndex(26), 1);
  assert.equal(cycleIndex(55), 1);
  assert.equal(cycleIndex(56), 2);
});

test('每一段都從第 1 個關卡列重新走，走滿 ThemeEnd 列', () => {
  assert.equal(backgroundIndex(1), 0);
  assert.equal(backgroundIndex(25), 24);
  assert.equal(backgroundIndex(26), 0);
  assert.equal(backgroundIndex(55), 29);
  assert.equal(backgroundIndex(56), 0);
  assert.equal(backgroundIndex(406), 0);
  // Every band covers exactly as many stages as it has levels, which is what makes the walk exact.
  for (const [index, row] of BACKGROUND_CYCLE.entries()) {
    const start = bandStart(row.level + 1);
    const next = BACKGROUND_CYCLE[index + 1];
    if (!next) continue;
    assert.equal(next.level - row.level, index === 0 ? row.themeEnd - 1 : row.themeEnd,
      `第 ${index} 段涵蓋的關卡數與 ThemeEnd 不符`);
    assert.equal(backgroundIndex(start), 0, `第 ${index} 段沒有從關卡列 1 開始`);
    assert.equal(backgroundIndex(next.level), row.themeEnd - 1, `第 ${index} 段沒有走到最後一列`);
  }
  // Nothing may point outside the table.
  for (let stage = 1; stage <= 4000; stage += 1) {
    const index = backgroundIndex(stage);
    assert.ok(index >= 0 && index < STAGE_LEVELS.length, `關卡 ${stage} 的列索引 ${index} 超出範圍`);
  }
});

test('載入幾隻與畫多大都照段走，隨關卡變寬變大', () => {
  assert.equal(monsterDiversity(1), 5);
  assert.equal(monsterDiversity(26), 6);
  assert.equal(monsterDiversity(3000), 10);
  assert.equal(monsterScale(1), 0.75);
  assert.equal(monsterScale(3000), 1.5);
  for (let stage = 1; stage <= 4000; stage += 7) {
    assert.equal(stagePool(stage).length, Math.min(monsterDiversity(stage), 10));
    assert.ok(monsterScale(stage) >= 0.75 && monsterScale(stage) <= 1.5);
  }
  // Both only ever grow as the run goes on.
  let diversity = 0, scale = 0;
  for (const row of BACKGROUND_CYCLE) {
    assert.ok(row.diversity >= diversity, '多樣性倒退');
    assert.ok(row.scale >= scale, '縮放倒退');
    diversity = row.diversity; scale = row.scale;
  }
});

test('頭目是該關卡列指定的那一隻，不是同一隻小怪換色', () => {
  for (let stage = 1; stage <= 500; stage += 1) {
    const level = stageLevel(stage);
    assert.equal(stageBossId(stage), level.boss);
    assert.equal(bossSprite(stage), spriteForMonster(level.boss));
  }
  // Stage 1 and stage 3 share a monster list but not a boss, which is the point of the boss column.
  assert.deepEqual(stagePool(1), stagePool(3));
  assert.notEqual(stageBossId(1), stageBossId(3));
});

test('每個識別字都有精靈，而且同一關卡列不會有兩隻長一樣', () => {
  assert.equal(MONSTER_IDS.length, 141);
  const sprites = new Set();
  for (const id of MONSTER_IDS) {
    const sprite = spriteForMonster(id);
    assert.ok(Number.isInteger(sprite) && sprite >= 0 && sprite < SPRITE_COUNT, `${id} 的精靈是 ${sprite}`);
    sprites.add(sprite);
  }
  assert.equal(sprites.size, SPRITE_COUNT, `只用到 ${sprites.size} 種精靈`);
  for (const level of STAGE_LEVELS) {
    const group = [level.boss, ...level.monsters];
    const distinct = new Set(group);
    const drawn = new Set(group.map(spriteForMonster));
    assert.equal(drawn.size, distinct.size, `關卡列 ${level.level} 有兩隻怪物共用外觀`);
  }
});

test('一般生成是在載入清單裡均勻挑一隻，不會挑到清單外', () => {
  for (const stage of [1, 26, 130, 1035, 2925]) {
    const pool = stagePool(stage).map(spriteForMonster);
    const seen = new Set();
    for (let i = 0; i < 1000; i += 1) seen.add(pickMonsterSprite(stage, i / 1000));
    assert.deepEqual([...seen].sort((a, b) => a - b), [...pool].sort((a, b) => a - b), `關卡 ${stage}`);
  }
  // The two ends of the roll must stay inside the pool rather than falling off it.
  assert.ok(stagePool(1).map(spriteForMonster).includes(pickMonsterSprite(1, 0)));
  assert.ok(stagePool(1).map(spriteForMonster).includes(pickMonsterSprite(1, 0.9999999)));
  assert.ok(stagePool(1).map(spriteForMonster).includes(pickMonsterSprite(1, 1)));
});

test('主題與世界地圖跟著同一條規則：新玩家只看到五個區域', () => {
  assert.equal(LEVELS_PER_THEME, THEME_STAGES);
  assert.equal(TT2_THEMES.length, STAGE_LEVELS.length / LEVELS_PER_THEME);
  for (let stage = 1; stage <= 1000; stage += 3) {
    assert.equal(themeIndex(stage), themeIndexFor(stage));
    assert.equal(TT2_THEMES[themeIndex(stage)].id, stageLevel(stage).theme, `關卡 ${stage} 的主題對不上關卡列`);
  }
  assert.equal(themesInBand(1), 5);
  assert.equal(themesInBand(26), 6);
  assert.equal(themesInBand(406), TT2_THEMES.length);
  assert.deepEqual(themeStageRange(0, 1), { first: 1, last: 5 });
  assert.deepEqual(themeStageRange(4, 1), { first: 21, last: 25 });
  assert.deepEqual(themeStageRange(0, 26), { first: 26, last: 30 });
  // Every theme the map offers has to be one the band actually reaches.
  for (const stage of [1, 26, 56, 406, 1200]) {
    for (let index = 0; index < themesInBand(stage); index += 1) {
      const { first } = themeStageRange(index, stage);
      assert.equal(TT2_THEMES[index].id, stageLevel(first).theme, `關卡 ${stage} 的地圖第 ${index} 列對不上`);
    }
  }
});

test('引擎把選到的怪物存進存檔，畫面不會每次重算出不同的怪', () => {
  const s = hydrate(fresh(1000));
  s.stage = 30; s.best = 30; s.kills = 0;
  advance(s, s.last + 100);
  const first = monsterIndex(s);
  assert.equal(typeof s.monster, 'number');
  // Reading it again must not roll again, or the sprite would change every frame.
  for (let i = 0; i < 20; i += 1) assert.equal(monsterIndex(s), first);
  assert.ok(stagePool(s.stage).map(spriteForMonster).includes(first), '選到的怪不在該關卡的載入清單裡');
});

test('舊存檔沒有這個欄位也能顯示怪物', () => {
  const s = hydrate(fresh(1000));
  s.stage = 12; s.kills = 2;
  delete s.monster;
  const shown = monsterIndex(s);
  assert.ok(Number.isInteger(shown) && shown >= 0 && shown < SPRITE_COUNT);
  assert.ok(stagePool(12).map(spriteForMonster).includes(shown) || isBoss(s));
});
