// Background themes in the order BackgroundInfo lists them, with the official Traditional Chinese
// name each one carries in the bundled localization file. Five stages belong to each theme, so a
// full cycle covers 70 stages. Verified against reference/tt2/8.2.0/BackgroundInfo.json by tests.
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

/** Zero-based theme index for a stage; themes repeat once the cycle is finished. */
export function themeIndex(stage: number) {
  const step = Math.floor((Math.max(1, Math.floor(stage)) - 1) / THEME_STAGES);
  return ((step % TT2_THEMES.length) + TT2_THEMES.length) % TT2_THEMES.length;
}

/** First and last stage of the cycle this stage sits in, for the world map list. */
export function themeStageRange(index: number, stage: number) {
  const cycle = Math.floor((Math.max(1, Math.floor(stage)) - 1) / (TT2_THEMES.length * THEME_STAGES));
  const first = cycle * TT2_THEMES.length * THEME_STAGES + index * THEME_STAGES + 1;
  return { first, last: first + THEME_STAGES - 1 };
}
