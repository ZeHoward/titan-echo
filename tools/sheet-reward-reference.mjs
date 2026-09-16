// Some bundled sheets use their own reward token vocabulary instead of the native RewardID grammar.
// This module only describes what those sheets contain; it never grants anything.
const quantity = /^\d+$/;
const qualifiers = new Set(['Common', 'Rare', 'Legendary']);

// Reward string token -> the sibling numeric column that repeats the same amount in the same row.
export const REWARD_COLUMNS = {
  TournamentRewardInfo: { field: 'Rewards', columns: { Diamonds: 'Diamonds', TitanPoints: 'TitanPoint',
    HolidayCurrency: 'HolidayCurrency', SkillPoint: 'SkillPoint', PerkTicket: 'PerkTicket',
    EquipmentShards: 'EquipmentShards', RandomLevelPet: 'Pet', HelperWeapon: 'Weapon',
    FortuneHelperWeapon: 'PremiumWeapon', AnniversaryMinigameCurrency: 'AnniversaryMinigameCurrency' } },
  SuperTournamentRewardInfo: { field: 'Rewards', columns: { Diamonds: 'Diamonds', TitanPoints: 'TitanPoint',
    HolidayCurrency: 'HolidayCurrency', SkillPoint: 'SkillPoint', PerkTicket: 'Perk',
    EquipmentShards: 'EquipmentShards', Pet: 'Pet', RandomLevelPet: 'Pet', HelperWeapon: 'Weapon',
    FortuneHelperWeapon: 'PremiumWeapon' } },
  ChallengeTournamentRewardInfo: { field: 'TournamentRewards', columns: { Diamonds: 'Diamonds',
    ChallengePoints: 'ChallengePoints', HolidayCurrency: 'HolidayCurrency', SkillPoint: 'SkillPoint',
    PerkTicket: 'PerkTicket', EquipmentShards: 'EquipmentShards', RandomLevelPet: 'Pet',
    HelperWeapon: 'HelperWeapon', FortuneHelperWeapon: 'FortuneHelperWeapon' } },
  SuperChallengeTournamentRewardInfo: { field: 'TournamentRewards', columns: { Diamonds: 'Diamonds',
    ChallengePoints: 'ChallengePoints', HolidayCurrency: 'HolidayCurrency', SkillPoint: 'SkillPoint',
    PerkTicket: 'PerkTicket', EquipmentShards: 'EquipmentShards', RandomLevelPet: 'Pet',
    HelperWeapon: 'HelperWeapon', FortuneHelperWeapon: 'FortuneHelperWeapon' } },
};

export const REWARD_FIELDS = {
  TournamentRewardInfo: ['Rewards'],
  SuperTournamentRewardInfo: ['Rewards', 'ResourceRewards', 'AvatarReward'],
  NewPlayerTournamentRewardInfo: ['RankReward'],
  ChallengeTournamentRewardInfo: ['TournamentRewards'],
  SuperChallengeTournamentRewardInfo: ['TournamentRewards', 'ResourceRewards', 'AvatarReward'],
  ChallengeTournamentProgressionRewardInfo: ['RewardString_Type1', 'RewardString_Type2', 'RewardString_Type3'],
  // The bomb game reward list also names FortuneHelperWeapon, which has no native RewardID.
  HolidayEventBombGameLevelInfo: ['RewardString'],
};

/** Split one sheet reward string into typed tokens without deciding what any of them grants. */
export function parseSheetRewardList(text, nativeRewardIds) {
  if (typeof text !== 'string') throw new Error('tournament reward must be a string');
  if (text === '' || text === '-' || text === 'None') return [];
  return text.split(',').map(raw => {
    const parts = raw.trim().split(':').map(part => part.trim());
    const [type, arg, count] = parts;
    if (!type) throw new Error(`empty tournament reward token: ${raw}`);
    const native = Object.hasOwn(nativeRewardIds, type) ? nativeRewardIds[type] : null;
    if (parts.length === 2 && quantity.test(arg)) return { type, quantity: arg, itemId: null, raw, nativeRewardId: native };
    if (parts.length === 2 && arg) return { type, quantity: null, itemId: arg, raw, nativeRewardId: native };
    if (parts.length === 3 && qualifiers.has(arg) && quantity.test(count)) {
      return { type, qualifier: arg, quantity: count, itemId: null, raw, nativeRewardId: native };
    }
    throw new Error(`unsupported tournament reward token: ${raw}`);
  });
}

/** Compare a row's reward string against the sibling amount columns that repeat the same numbers. */
export function compareRewardColumns(table, row, nativeRewardIds) {
  const spec = REWARD_COLUMNS[table];
  if (!spec) return null;
  const tokens = parseSheetRewardList(row.values[spec.field], nativeRewardIds);
  const agreed = [], diverged = [], covered = new Set();
  for (const token of tokens) {
    const column = spec.columns[token.type];
    if (column === undefined) continue;
    covered.add(column);
    const cell = row.values[column];
    (cell === token.quantity ? agreed : diverged).push({ type: token.type, column, token: token.quantity, cell: cell ?? null });
  }
  for (const [type, column] of Object.entries(spec.columns)) {
    const cell = row.values[column];
    if (cell === undefined || cell === '' || cell === '0' || covered.has(column)) continue;
    diverged.push({ type, column, token: null, cell });
  }
  return { field: spec.field, agreed, diverged };
}
