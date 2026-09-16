// Ceilings taken from the 8.2.0 package, replacing three numbers the web engine invented
// (stage 1800, hero level 2000, player level 2000). Each one is pinned to a reference record
// by tests/level-limits.test.mjs:
//  - STAGE_CAP: ServerVarsInfo maxStage, iOS column.
//  - HERO_LEVEL_CAP: highest Level in HelperImprovementsInfo.
//  - PLAYER_LEVEL_CAP: highest Level in PlayerImprovementsInfo.
// These are the limits the data records, not a claim that the live server uses the same ones.
export const STAGE_CAP = 98000;
export const HERO_LEVEL_CAP = 6000;
export const PLAYER_LEVEL_CAP = 12500;
