// Parse only the observed bundled dialect. No resource mutation or reward granting.
const quantity = /^\d+$/;
const scalarTypes = new Set(['Equipment', 'RaidWildcard', 'SeasonalPetsLvl1', 'RaidCard', 'SeasonalPetsLvl5',
  'SkillPoint', 'PerkTicket', 'PetParadiseCurrency', 'PetsLvl1', 'Diamonds', 'BombGameCurrency',
  'MinigameQuestCurrency', 'MinigameFishingCurrency', 'MinigameDigsiteCurrency', 'MinigameHuntingCurrency',
  'MinigameBallDropPrestigeCurrency', 'TitanSouls', 'GemstoneCurrency', 'PetsLvl5', 'Alchemy', 'EquipmentShards']);
const itemTables = { RaidCard: 'RaidSkillInfo', Pet: 'PetInfo', EquipmentSet: 'EquipmentSetInfo' };

export function parseRewardReference(text, field, catalogs, nativeRewardIds) {
  if (typeof text !== 'string') throw new Error('reward must be a string');
  if (!['RewardString', 'ClanGift', 'SelectionSlotContents1', 'SelectionSlotContents2',
    'SelectionSlotContents3', 'SelectionSlotContents4'].includes(field)) throw new Error('unsupported reward field');
  const mode = field.startsWith('SelectionSlotContents') ? 'choice-candidates' : field === 'ClanGift' ? 'clan-gift-list' : 'reward-list';
  const entries = [];
  if (text !== '' && text !== 'None' && text !== '-') for (const token of text.split(',')) {
    const parts = token.trim().split(':').map(v => v.trim());
    const [type, arg, count] = parts;
    if (!Object.hasOwn(nativeRewardIds, type)) throw new Error(`unknown reward type: ${type}`);
    let entry;
    if (parts.length === 2 && type === 'EquipmentSet') {
      entry = { type, itemId: arg, quantity: null, target: itemTables[type] };
    } else if (parts.length === 2 && scalarTypes.has(type) && quantity.test(arg)) {
      entry = { type, quantity: arg, itemId: null, target: null };
    } else if (parts.length === 3 && quantity.test(count) && ['RaidCard', 'Pet'].includes(type)) {
      entry = { type, itemId: arg, quantity: count, target: itemTables[type] };
    } else if (parts.length === 3 && type === 'Equipment' && ['Rare', 'Legendary'].includes(arg) && quantity.test(count)) {
      entry = { type, qualifier: arg, quantity: count, itemId: null, target: null };
    } else throw new Error(`unsupported reward token: ${token}`);
    if (entry.target && !catalogs[entry.target]?.records.some(r => r.id === entry.itemId)) {
      throw new Error(`unknown ${entry.target} ID: ${entry.itemId}`);
    }
    entries.push({ ...entry, raw: token });
  }
  return { mode, entries, interpretation: 'observed-bundled-syntax',
    choiceCount: null, deliveryRules: 'unverified', runtimeEnabled: false };
}
