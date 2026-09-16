// Background themes in the order BackgroundInfo lists them, with the official Traditional Chinese
// name each one carries in the bundled localization file. Five stages belong to each theme.
//
// Which theme a stage shows is not a plain cycle over all fourteen: BackgroundCycleInfo splits the
// run into bands and each band walks only the first `themeEnd` levels, so a new player sees five
// zones repeating and the rest arrive as the bands widen. lib/tt2-stages.ts holds that rule.
import { themeIndexFor, themeRange } from './tt2-stages.ts';

export const THEME_STAGES = 5;

export const TT2_THEMES = [
  { id: 'ForgottenRuins', name: '約特王國' },
  { id: 'EnchantedForest', name: '神聖森林' },
  { id: 'FalloutLand', name: '簡陋城鎮' },
  { id: 'Savannah', name: '部落前哨站' },
  { id: 'LostCity', name: '隱密城市' },
  { id: 'Moonlight', name: '尼克斯林線' },
  { id: 'Canyon', name: '龍族空地' },
  { id: 'MechFactory', name: '機器人工廠' },
  { id: 'Cybertown', name: '金屬之城' },
  { id: 'FlamingCavern', name: '地底深處' },
  { id: 'BushidoValley', name: '日落之城' },
  { id: 'ArcaneFields', name: '東方之港' },
  { id: 'Meadow', name: '深藍草原' },
  { id: 'IceGuardians', name: '寒冷國度' },
] as const;

/** Zero-based theme index for a stage, from the level the background rule selects. */
export function themeIndex(stage: number) {
  return themeIndexFor(stage);
}

/** First and last stage of a theme inside the band this stage sits in, for the world map list. */
export function themeStageRange(index: number, stage: number) {
  return themeRange(index, stage);
}
