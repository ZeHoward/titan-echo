// Parse only the observed bundled dialect. No resource mutation or reward granting.
const quantity = /^\d+$/;
const scalarTypes = new Set(['Equipment', 'RaidWildcard', 'SeasonalPetsLvl1', 'RaidCard', 'SeasonalPetsLvl5',
  'SkillPoint', 'PerkTicket', 'PetParadiseCurrency', 'PetsLvl1', 'Diamonds', 'BombGameCurrency',
  'MinigameQuestCurrency', 'MinigameFishingCurrency', 'MinigameDigsiteCurrency', 'MinigameHuntingCurrency',
  'MinigameBallDropPrestigeCurrency', 'TitanSouls', 'GemstoneCurrency', 'PetsLvl5', 'Alchemy', 'EquipmentShards',
  'FortuneRaidCard', 'PlayerRaidXP']);
const itemTables = { RaidCard: 'RaidSkillInfo', Pet: 'PetInfo', EquipmentSet: 'EquipmentSetInfo',
  Avatar: 'AvatarInfo', Frame: 'AvatarFrameInfo', Title: 'PlayerTitleInfo' };

export function parseRewardReference(text, field, catalogs, nativeRewardIds, options = {}) {
  if (typeof text !== 'string') throw new Error('reward must be a string');
  if (!['RewardString', 'RankReward', 'ClanGift', 'Reward', 'NewPlayerReward', 'SelectionSlotContents1',
    'SelectionSlotContents2', 'SelectionSlotContents3', 'SelectionSlotContents4'].includes(field)) throw new Error('unsupported reward field');
  const mode = field.startsWith('SelectionSlotContents') ? 'choice-candidates' : field === 'ClanGift' ? 'clan-gift-list' : 'reward-list';
  const entries = [], candidates = [], missingTargets = [];
  const populated = text !== '' && text !== 'None' && text !== '-';
  const groups = !populated ? [] : mode === 'choice-candidates' ? text.split(',') : [text];
  for (const [candidateIndex, group] of groups.entries()) {
    const candidateEntries = [];
    for (const token of group.split(mode === 'choice-candidates' ? /;/ : /[;,]/)) {
    const parts = token.trim().split(':').map(v => v.trim());
    const [type, arg, count] = parts;
    if (!Object.hasOwn(nativeRewardIds, type)) throw new Error(`unknown reward type: ${type}`);
    let entry;
    if (parts.length === 2 && ['EquipmentSet', 'Avatar', 'Frame', 'Title'].includes(type)) {
      entry = { type, itemId: arg, quantity: null, target: itemTables[type] };
    } else if (parts.length === 2 && scalarTypes.has(type) && quantity.test(arg)) {
      entry = { type, quantity: arg, itemId: null, target: null };
    } else if (parts.length === 3 && quantity.test(count) && ['RaidCard', 'Pet'].includes(type)) {
      entry = { type, itemId: arg, quantity: count, target: itemTables[type] };
    } else if (parts.length === 3 && type === 'Equipment' && ['Rare', 'Legendary'].includes(arg) && quantity.test(count)) {
      entry = { type, qualifier: arg, quantity: count, itemId: null, target: null };
    } else throw new Error(`unsupported reward token: ${token}`);
    if (entry.target && !catalogs[entry.target]?.records.some(r => r.id === entry.itemId)) {
      // Reporting mode lets the caller decide whether a missing target is a source gap or a lost row.
      if (options.missingTargets !== 'report') throw new Error(`unknown ${entry.target} ID: ${entry.itemId}`);
      missingTargets.push({ type, target: entry.target, itemId: entry.itemId });
      entry = { ...entry, targetMissing: true };
    }
    const nativeType = entry.qualifier ? type + entry.qualifier : type;
    if (!Object.hasOwn(nativeRewardIds, nativeType)) throw new Error(`unknown native reward type: ${nativeType}`);
    const parsed = { ...entry, raw: token, nativeType, nativeValue: parts.length === 2 ? arg : count,
      nativeItemId: parts.length === 3 && entry.target ? arg : '' };
    entries.push(parsed);
    candidateEntries.push(parsed);
    }
    if (mode === 'choice-candidates') candidates.push({ index: candidateIndex, entries: candidateEntries });
  }
  return { mode, entries, candidates, missingTargets, interpretation: 'native-verified-valid-dialect',
    evidence: 'reward-parser-evidence.json', choiceCount: mode === 'choice-candidates' ? 1 : null,
    unselectedIndex: mode === 'choice-candidates' ? -1 : null,
    deliveryRules: 'unverified', runtimeEnabled: false };
}

// Reference selection only: no balance updates, persistence or purchase handling.
export function selectRewardCandidate(parsed, index) {
  if (parsed.mode !== 'choice-candidates' || !Number.isInteger(index) || index < -1 || index >= parsed.candidates.length) {
    throw new Error('invalid reward selection');
  }
  return index === -1 ? [] : structuredClone(parsed.candidates[index].entries);
}
