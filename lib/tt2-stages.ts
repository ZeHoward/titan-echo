// Which titan stands on a stage, and how large it is drawn.
//
// Two bundled tables decide this and the native code that reads them is recorded in
// reference/tt2/8.2.0/stage-monster-evidence.json. The shape is:
//
//   BackgroundCycleInfo splits the run into bands. A band starts at its `level` key and lasts
//   exactly `themeEnd` stages, and inside a band the background walks levels 1..themeEnd and then
//   would wrap. Early on a band is short — the first covers 25 stages — so a new player cycles the
//   first five themes only; the bands grow until stage 406, from where all 70 levels are in play.
//
//   BackgroundInfo is those 70 levels: each carries a theme, a stage boss and ten monsters. Only
//   the first `diversity` of the ten are loaded at a given band, and a normal spawn is a uniform
//   pick among the loaded ones. The boss is the level's own, not a tinted small monster.
//
// The art is this project's own, so an identifier is mapped to one of the sprites we have. That
// mapping is arbitrary but fixed: what the tables restore is which creature recurs where, not how
// it looks.
import { BACKGROUND_CYCLE, MONSTER_IDS, MONSTER_SPRITES, STAGE_LEVELS } from './tt2-stages-data.ts';

export { BACKGROUND_CYCLE, MONSTER_IDS, MONSTER_SPRITES, STAGE_LEVELS };
export const SPRITE_COUNT = 60;

const clampStage = (stage: number) => Math.max(1, Math.floor(stage) || 1);

/**
 * Which cycle band a stage falls in.
 *
 * The native does a binary search over the band keys and then steps back one, so a stage that is
 * exactly a key still belongs to the band before it: stage 25 is the last stage of the first band,
 * not the first of the second.
 */
export function cycleIndex(stage: number) {
  const level = clampStage(stage);
  let found = -1;
  for (let i = 0; i < BACKGROUND_CYCLE.length; i += 1) {
    if (BACKGROUND_CYCLE[i].level <= level) found = i;
    else break;
  }
  if (found < 0) return 0;
  // An exact key match steps back; anything past the key keeps its band.
  const exact = BACKGROUND_CYCLE[found].level === level;
  const index = exact ? found - 1 : found;
  return Math.max(0, index);
}

export const cycleRow = (stage: number) => BACKGROUND_CYCLE[cycleIndex(stage)];

/** Zero-based index into STAGE_LEVELS: the band restarts the walk and runs `themeEnd` levels. */
export function backgroundIndex(stage: number) {
  const level = clampStage(stage);
  const band = cycleIndex(stage);
  const row = BACKGROUND_CYCLE[band];
  const offset = level - row.level - (band > 0 ? 1 : 0);
  const index = offset % row.themeEnd;
  return index < 0 ? 0 : index;
}

export const stageLevel = (stage: number) => STAGE_LEVELS[backgroundIndex(stage)];

/** How many of the level's ten monsters are in play, 5 at the start and 10 past stage 2925. */
export const monsterDiversity = (stage: number) => cycleRow(stage).diversity;

/** How large the sprite is drawn, 0.75 at the start and 1.5 past stage 2925. */
export const monsterScale = (stage: number) => cycleRow(stage).scale;

/** The monsters a normal spawn draws from, in table order. */
export function stagePool(stage: number) {
  const level = stageLevel(stage);
  return level.monsters.slice(0, Math.min(monsterDiversity(stage), level.monsters.length));
}

export const stageBossId = (stage: number) => stageLevel(stage).boss;

// The generator assigns the sprites so that no level ever needs one twice while all sixty stay in
// rotation; this is only the lookup.
const spriteByMonster = new Map<string, number>(MONSTER_IDS.map((id, index) => [id, MONSTER_SPRITES[index]]));

/** The sprite this project draws for a bundled monster identifier. */
export function spriteForMonster(id: string) {
  return spriteByMonster.get(id) ?? 0;
}

/** The sprite for a normal spawn: a uniform pick from the level's loaded monsters. */
export function pickMonsterSprite(stage: number, roll: number) {
  const pool = stagePool(stage);
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(roll * pool.length)));
  return spriteForMonster(pool[index]);
}

/** The sprite for the stage's boss, which is the level's own boss rather than a tinted monster. */
export const bossSprite = (stage: number) => spriteForMonster(stageBossId(stage));

/** Levels per theme, read off the table rather than assumed. */
export const LEVELS_PER_THEME = STAGE_LEVELS.filter(level => level.theme === STAGE_LEVELS[0].theme).length;

/**
 * The stage whose background index is 0 for the walk this stage is in.
 *
 * A band covers exactly `themeEnd` stages, so the last row's rule keeps repeating past its own
 * key — the walk restarts every `themeEnd` stages rather than staying pinned to where the row
 * began. Without the modulo the world map froze at 3066–3135 for every stage past 3080, because
 * every one of them falls in that final row.
 */
export const bandStart = (stage: number) => {
  const band = cycleIndex(stage);
  const row = BACKGROUND_CYCLE[band];
  const start = row.level + (band > 0 ? 1 : 0);
  return start + Math.floor((clampStage(stage) - start) / row.themeEnd) * row.themeEnd;
};

/**
 * How many themes the current band reaches. A new player cycles five zones, not fourteen: the first
 * band only walks 25 of the 70 levels, and the bands widen until all of them are in play.
 */
export function themesInBand(stage: number) {
  const themes = STAGE_LEVELS.length / LEVELS_PER_THEME;
  return Math.max(1, Math.min(themes, Math.ceil(cycleRow(stage).themeEnd / LEVELS_PER_THEME)));
}

/** First and last stage of a theme inside the band this stage is in. */
export function themeRange(index: number, stage: number) {
  const first = bandStart(stage) + index * LEVELS_PER_THEME;
  return { first, last: first + LEVELS_PER_THEME - 1 };
}

/** Zero-based theme index for a stage, straight off the level the background rule selects. */
export function themeIndexFor(stage: number) {
  const theme = stageLevel(stage).theme;
  const themes: string[] = [];
  for (const level of STAGE_LEVELS) if (!themes.includes(level.theme)) themes.push(level.theme);
  return Math.max(0, themes.indexOf(theme));
}
