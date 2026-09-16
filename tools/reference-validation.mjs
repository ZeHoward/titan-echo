// Validation only. This module must not be imported by the game or choose live rules.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseRewardReference } from './reward-reference.mjs';

export const referenceRoot = new URL('../reference/tt2/8.2.0/', import.meta.url);
export function loadCatalogs() {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', referenceRoot), 'utf8'));
  return Object.fromEntries(manifest.tables.map(({ table }) => [table,
    JSON.parse(readFileSync(new URL(table + '.json', referenceRoot), 'utf8'))]));
}
const missing = value => value === '' || value === '-';
const none = value => missing(value) || value === 'None';
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const bool = value => /^(true|false)$/i.test(value);
const list = value => none(value) ? [] : value.split(',').map(s => s.trim());
const isFalse = value => value === '0' || /^false$/i.test(value ?? '');

export function classify(table, row, catalogs) {
  const v = row.values;
  const evidence = [];
  let bundledState = 'unspecified';
  for (const field of ['Enabled', 'IsActive', 'IsInGame']) {
    if (v[field] !== undefined) {
      evidence.push(`${field}=${v[field]}`);
      if (isFalse(v[field])) bundledState = 'disabled';
      else if (bundledState !== 'disabled' && /^(true|1)$/i.test(v[field])) bundledState = 'enabled';
    }
  }
  let scope = 'unclassified';
  const variant = catalogs[table]?.variantOfSource;
  if (variant) {
    scope = 'source-variant';
    evidence.push(`base-table=${variant.baseTable}`, 'live-variant-selection=unknown');
  }
  if (['ServerVarsInfo', 'ServerVarOverride'].includes(table)) {
    // Bundled defaults and bundled overrides; the values the live server sends are not in the package.
    scope = 'bundled-server-variable';
    evidence.push(`table=${table}`, 'live-server-value=unknown');
  }
  if (/^TitanScalingInfo(_[ABC])?$/.test(table)) {
    scope = 'ab-test-source-variant';
    evidence.push(`source-table=${table}`, 'ab-sheet-assignment=unknown');
  }
  if (/^(Raid|SoloRaid)/.test(table)) {
    scope = 'raid';
    evidence.push(`table=${table}`);
  }
  if (['AvatarInfo', 'AvatarFrameInfo', 'PlayerTitleInfo', 'AvatarParticleInfo'].includes(table)) {
    scope = 'cosmetic-unlock-definition';
    for (const field of ['AvatarUnlockType', 'TitleUnlockType', 'UnlockType', 'UnlockValue', 'CollectionName']) {
      if (v[field] !== undefined) evidence.push(`${field}=${v[field]}`);
    }
  }
  if (table === 'ProfileBackgroundInfo') {
    // The bundled table only partitions backgrounds by slot; it carries no unlock column at all.
    scope = 'cosmetic-category-entry';
    evidence.push(`ProfileBackgroundType=${v.ProfileBackgroundType}`, 'unlock-source=not-in-table');
  }
  if (table.startsWith('Endgame')) {
    scope = 'endgame-source-variant';
    evidence.push(`source-table=${table}`, 'live-variant-selection=unknown');
  } else if (table.startsWith('Gemstone')) {
    scope = 'gemstone';
    evidence.push(`source-table=${table}`);
  } else if (table === 'PetQuestLevelInfo') {
    scope = 'pet-quest-progression';
    evidence.push('table=PetQuestLevelInfo');
  }
  if (['RaidSkillInfo', 'RaidSkillCardCostInfo', 'RaidPlayerInfo', 'RaidEnemyInfo', 'RaidEnemyPartInfo', 'RaidLevelInfo', 'RaidAreaInfo'].includes(table)) {
    scope = 'raid';
    evidence.push(`table=${table}`);
  }
  if (table === 'ShopBundleInfo') {
    scope = /^true$/i.test(v.HideIfHolidayEventIsNotActive) ? 'event-gated-bundle' : 'shop-bundle';
    evidence.push(`HideIfHolidayEventIsNotActive=${v.HideIfHolidayEventIsNotActive}`);
    for (const field of ['StartDate', 'StartDateNoTime', 'EndDateNoTime', 'TestGroup', 'TestGroupName', 'Country']) {
      if (v[field] && v[field] !== '-') evidence.push(`${field}=${v[field]}`);
    }
  }
  if (['Maingame', 'Raid'].includes(v.Type)) {
    scope = v.Type === 'Raid' ? 'raid' : 'main-game';
    evidence.push(`Type=${v.Type}`);
  }
  if (table === 'ActiveSkillInfo') {
    scope = v.SkillType === 'Fairy' ? 'fairy-effect' : v.SkillType === 'ActiveSkill' ? 'active-skill' : 'unclassified';
    evidence.push(`SkillType=${v.SkillType}`);
  }
  if (table === 'EquipmentSetInfo') {
    scope = v.SetType === 'Event' ? 'event-set' : 'non-event-set';
    evidence.push(`SetType=${v.SetType}`);
  }
  if (table === 'C_EquipmentInfo') {
    const set = catalogs.EquipmentSetInfo?.records.find(r => r.id === v.EquipmentSet);
    evidence.push(`LimitedTime=${v.LimitedTime}`, `EquipmentSet=${v.EquipmentSet}`);
    if (/^true$/i.test(v.LimitedTime) || set?.values.SetType === 'Event') {
      scope = 'event-or-limited-equipment';
      if (set?.values.SetType === 'Event') evidence.push('EquipmentSet.SetType=Event');
    } else if (/^false$/i.test(v.LimitedTime) && (v.EquipmentSet === 'None' || set)) {
      scope = 'non-event-equipment';
    }
  }
  const rewards = [v.Reward, v.RewardString].filter(Boolean).join(',');
  const eventTokens = [...new Set(rewards.split(',').map(t => t.split(':')[0])
    .filter(t => /^(HolidayCurrency|AnniversaryMinigameCurrency|Alchemy)$/.test(t)))];
  if (eventTokens.length) {
    scope = 'mixed-event-rewards';
    evidence.push(...eventTokens.map(t => `reward-token=${t}`));
  }
  if (table === 'HolidayEventTypeInfo') {
    scope = 'event-configuration';
    evidence.push('table=HolidayEventTypeInfo');
  }
  if (table === 'ChallengeTournamentInfo') {
    scope = 'challenge-configuration';
    evidence.push('table=ChallengeTournamentInfo');
  }
  return { id: row.id, bundledState, scope, liveAvailability: 'unknown', activation: 'unverified', evidence };
}

export function loadNativeBonuses() {
  return JSON.parse(readFileSync(new URL('native-bonus-types.json', referenceRoot), 'utf8')).values;
}

export function loadNativeCosmetics() {
  return JSON.parse(readFileSync(new URL('native-cosmetic-types.json', referenceRoot), 'utf8'));
}

export function auditCatalogs(catalogs, nativeBonuses = loadNativeBonuses(), nativeCosmetics = loadNativeCosmetics()) {
  const nativeRewards = JSON.parse(readFileSync(new URL('native-reward-types.json', referenceRoot), 'utf8')).values;
  const errors = [], unresolved = [], nativeOnly = [], deferredReferences = [], rewardReferences = [], classifications = {}, referenceCounts = {};
  const cosmeticTypes = nativeCosmetics.types ?? {}, cosmeticTables = nativeCosmetics.tableTypes ?? {};
  const ids = Object.fromEntries(Object.entries(catalogs).map(([name, data]) => [name, new Set(data.records.map(r => r.id))]));
  function ref(table, row, field, target, multiple = false, quantities = false) {
    const raw = row.values[field];
    if (raw === undefined || none(raw)) return;
    let values = multiple ? list(raw) : [raw];
    if (quantities) values = values.map(token => {
      const match = /^([^:]+):(\d+)$/.exec(token);
      if (!match) { errors.push(`${table}/${row.id}.${field}: invalid ID quantity`); return token; }
      return match[1];
    });
    for (const value of values) {
      const label = `${table}.${field} -> ${target}`;
      referenceCounts[label] = (referenceCounts[label] ?? 0) + 1;
      if (!ids[target]?.has(value)) {
        const issue = { table, id: row.id, field, value, target };
        if (target === 'BonusInfo' && Object.hasOwn(nativeBonuses, value)) {
          nativeOnly.push({ ...issue, enumValue: nativeBonuses[value], formulaStatus: 'unverified' });
        } else unresolved.push(issue);
      }
    }
  }
  // Cosmetic columns are typed by native enums, so an unknown member is a source change, not a new item.
  function enumRef(table, row, field, typeName) {
    const value = row.values[field];
    referenceCounts[`${table}.${field} -> ${typeName}`] = (referenceCounts[`${table}.${field} -> ${typeName}`] ?? 0) + 1;
    if (typeof value !== 'string' || missing(value) || !Object.hasOwn(cosmeticTypes[typeName] ?? {}, value)) {
      unresolved.push({ table, id: row.id, field, value: value ?? null, target: typeName });
    }
  }
  for (const [table, data] of Object.entries(catalogs)) {
    if (ids[table].size !== data.records.length) errors.push(`${table}: duplicate IDs`);
    classifications[table] = [];
    for (const row of data.records) {
      const label = `${table}/${row.id}`;
      const parts = data.keys.map(k => row.values[k]);
      if (parts.some(p => typeof p !== 'string' || missing(p)) ||
          row.id !== (parts.length === 1 ? parts[0] : JSON.stringify(parts))) errors.push(`${label}: key mismatch`);
      if (Object.keys(row.values).sort().join('\0') !== Object.keys(data.schema).sort().join('\0')) errors.push(`${label}: schema columns differ`);
      for (const [field, kind] of Object.entries(data.schema)) {
        const value = row.values[field];
        if (typeof value !== 'string') { errors.push(`${label}.${field}: expected string`); continue; }
        if (missing(value)) continue;
        if (kind === 'decimal' && !decimal.test(value)) errors.push(`${label}.${field}: invalid decimal`);
        if (kind === 'boolean' && !bool(value)) errors.push(`${label}.${field}: invalid boolean`);
        if (!['decimal', 'boolean', 'identifier', 'token'].includes(kind)) errors.push(`${label}.${field}: unknown schema kind`);
      }
      for (const field of ['Enabled', 'IsActive', 'LimitedTime', 'RunWhileInactive', 'CanFairyRandomDrop', 'IsFlying']) {
        if (row.values[field] !== undefined && !bool(row.values[field])) errors.push(`${label}.${field}: invalid flag`);
      }
      if (row.values.MaxLevel !== undefined && !/^\d+$/.test(row.values.MaxLevel)) errors.push(`${label}: invalid MaxLevel`);
      for (const field of Object.keys(row.values)) {
        if (/^(BonusType(?:[A-J]|[1-3])?|ClassBonusType|SpatialBonusType)$/.test(field)) ref(table, row, field, 'BonusInfo');
      }
      if (table === 'RaidLevelInfo') {
        ref(table, row, 'EnemyIDs', 'RaidEnemyInfo', true);
        ref(table, row, 'AreaID', 'RaidAreaInfo');
        if (!bool(row.values.HasArmor)) errors.push(`${label}.HasArmor: invalid flag`);
        for (const field of ['TierID', 'LevelID', 'TitanCount', 'AttacksPerReset']) {
          if (!/^[1-9]\d*$/.test(row.values[field])) errors.push(`${label}.${field}: invalid positive integer`);
        }
      }
      if (table === 'GemstoneLevelCost') ref(table, row, 'GemstoneProgressionBundle', 'ShopBundleInfo');
      if (table === 'GemstoneLevelSummonRateInfo') {
        for (let rarity = 0; rarity <= 4; rarity++) {
          const field = `Rarity${rarity}`;
          if (!/^\d+$/.test(row.values[field])) errors.push(`${label}.${field}: invalid nonnegative weight`);
          if (!ids.GemstoneRarityInfo?.has(String(rarity))) unresolved.push({ table, id: row.id,
            field, value: String(rarity), target: 'GemstoneRarityInfo' });
        }
        if (![0,1,2,3,4].some(r => Number(row.values[`Rarity${r}`]) > 0)) errors.push(`${label}: empty rarity weight pool`);
      }
      if (table === 'PetQuestLevelInfo') {
        for (let level = 1; level <= 120; level++) {
          const value = row.values[`LVL${level}`];
          if (row.id === 'DifficultyChancePerLevel') {
            const probabilities = typeof value === 'string' ? value.split(',') : [];
            if (probabilities.length !== 10 || probabilities.some(p => !decimal.test(p) || Number(p) < 0 || Number(p) > 1) ||
                Math.abs(probabilities.reduce((sum,p) => sum + Number(p), 0) - 1) > 0.00001) {
              errors.push(`${label}.LVL${level}: invalid difficulty probability vector`);
            }
          } else if (typeof value !== 'string' || !decimal.test(value)) errors.push(`${label}.LVL${level}: missing quest progression value`);
        }
      }
      if (/^(SoloRaidLevelInfo|SoloRaidFarmingLevelInfo|RaidMasterTierLevelInfo)$/.test(table)) {
        ref(table, row, 'EnemyIDs', 'RaidEnemyInfo', true);
        ref(table, row, 'AreaID', 'RaidAreaInfo');
        ref(table, row, 'AvatarReward', 'AvatarInfo');
        for (const field of ['HasArmor', 'Enabled']) {
          if (row.values[field] !== undefined && !bool(row.values[field])) errors.push(`${label}.${field}: invalid flag`);
        }
        for (const field of ['TitanCount', 'MaxAttacks', 'AttacksPerReset', 'MaxDecks']) {
          if (row.values[field] !== undefined && !/^[1-9]\d*$/.test(row.values[field])) {
            errors.push(`${label}.${field}: invalid positive integer`);
          }
        }
      }
      if (table === 'RaidResearchInfo') {
        for (const value of list(row.values.RequiredResearchID)) {
          const link = 'RaidResearchInfo.RequiredResearchID -> RaidResearchInfo';
          referenceCounts[link] = (referenceCounts[link] ?? 0) + 1;
          if (ids[table].has(value)) continue;
          // A dangling prerequisite is only tolerated on a row that grants nothing and cannot be levelled.
          const inert = row.values.BonusType === 'None' && row.values.MaxLevel === '0'
            && row.values.ResearchPointsPerLevel === '0';
          if (inert) {
            deferredReferences.push({ table, id: row.id, field: 'RequiredResearchID', value, target: table,
              reason: 'prerequisite row is not in the bundled table; the referencing row has no effect, max level or cost' });
          } else unresolved.push({ table, id: row.id, field: 'RequiredResearchID', value, target: table });
        }
      }
      if (table === 'RaidCardLevelRewardInfo') {
        const costLink = 'RaidCardLevelRewardInfo.CardLevel -> RaidSkillCardCostInfo';
        referenceCounts[costLink] = (referenceCounts[costLink] ?? 0) + 1;
        if (!ids.RaidSkillCardCostInfo?.has(row.id)) unresolved.push({ table, id: row.id,
          field: 'CardLevel', value: row.id, target: 'RaidSkillCardCostInfo' });
      }
      if (/^(RaidMasterTierRewardInfo(_1)?|SoloRaidLevelInfo|SoloRaidFarmingLevelInfo)$/.test(table)) {
        for (const field of ['RankReward', 'Reward', 'NewPlayerReward']) {
          if (row.values[field] === undefined || none(row.values[field])) continue;
          try {
            const parsed = parseRewardReference(row.values[field], field, catalogs, nativeRewards, { missingTargets: 'report' });
            rewardReferences.push({ table, id: row.id, field, activation: 'unverified', ...parsed });
            for (const miss of parsed.missingTargets) {
              // A name the whole package does not know is a source gap; a name it knows is a lost catalog row.
              const enumName = cosmeticTables[miss.target]?.idType;
              if (enumName && !Object.hasOwn(cosmeticTypes[enumName] ?? {}, miss.itemId)) {
                deferredReferences.push({ table, id: row.id, field, value: miss.itemId, target: miss.target,
                  reason: `absent from both the ${miss.target} catalog and the native ${enumName} enum in this package` });
              } else errors.push(`${label}.${field}: unknown ${miss.target} ID: ${miss.itemId}`);
            }
          } catch (error) { errors.push(`${label}.${field}: ${error.message}`); }
        }
      }
      if (table === 'EndgameSeasonRewardInfo' || table === 'EndgameSeasonRewardInfo_1') {
        try {
          rewardReferences.push({ table, id: row.id, field: 'RankReward', season: row.values.SEASON,
            activation: 'unverified', ...parseRewardReference(row.values.RankReward, 'RankReward', catalogs, nativeRewards) });
        } catch (error) { errors.push(`${label}.RankReward: ${error.message}`); }
      }
      if (table === 'ShopBundleInfo') {
        ref(table, row, 'UnlockNextBundle', table);
        ref(table, row, 'EquipmentID', 'C_EquipmentInfo', true);
        ref(table, row, 'RaidCardID', 'RaidSkillInfo', true, true);
        for (const field of ['DailyDeliveryID', 'RewardString', 'SelectionSlotContents1', 'SelectionSlotContents2', 'SelectionSlotContents3', 'SelectionSlotContents4', 'ClanGift']) {
          if (none(row.values[field])) continue;
          if (field === 'DailyDeliveryID') {
            deferredReferences.push({ table, id: row.id, field, value: row.values[field],
              reason: 'delivery schedule unavailable; client has shop-response schedule parsing methods' });
          } else {
            try {
              rewardReferences.push({ table, id: row.id, field,
                ...parseRewardReference(row.values[field], field, catalogs, nativeRewards) });
            } catch (error) { errors.push(`${label}.${field}: ${error.message}`); }
          }
        }
      }
      if (table === 'RaidEnemyPartInfo') {
        for (const field of ['ProtectingPart', 'ProtectedPart', 'OppositePart', 'LinkedParts']) {
          ref(table, row, field, table, field === 'LinkedParts');
        }
        for (const field of ['IsDestructible', 'HasHealth']) {
          if (!bool(row.values[field])) errors.push(`${label}.${field}: invalid flag`);
        }
      }
      if (table === 'RaidSkillInfo') {
        const max = Number(row.values.MaxLevel);
        if (!Number.isInteger(max) || max < 1 || max > 150) errors.push(`${label}: unsupported card level range`);
        else for (let level = 1; level <= max; level++) {
          for (const prefix of ['A', 'B']) {
            const value = row.values[prefix + level];
            if (typeof value !== 'string' || !decimal.test(value)) errors.push(`${label}.${prefix}${level}: missing card level value`);
          }
          const costLink = 'RaidSkillInfo.MaxLevel -> RaidSkillCardCostInfo';
          referenceCounts[costLink] = (referenceCounts[costLink] ?? 0) + 1;
          if (!ids.RaidSkillCardCostInfo?.has(String(level))) unresolved.push({ table, id: row.id,
            field: 'MaxLevel', value: String(level), target: 'RaidSkillCardCostInfo' });
        }
        for (const field of ['Chance', 'MaxChance']) {
          const value = Number(row.values[field]);
          if (missing(row.values[field]) || !Number.isFinite(value) || value < 0 || value > 1) errors.push(`${label}.${field}: invalid probability`);
        }
      }
      if (table === 'RaidSkillCardCostInfo' || table === 'RaidPlayerInfo') {
        const fields = table === 'RaidSkillCardCostInfo' ? ['Level', 'Cost'] : ['PlayerLevel', 'ExperienceCost', 'DecksAvailable', 'SkillsPerDeck', 'ShopTier'];
        for (const field of fields) {
          if (!/^\d+$/.test(row.values[field])) errors.push(`${label}.${field}: invalid nonnegative integer`);
        }
        if (table === 'RaidPlayerInfo' && !none(row.values.PlayerRaidProgressionBundle)) {
          ref(table, row, 'PlayerRaidProgressionBundle', 'ShopBundleInfo');
        }
      }
      if (table === 'RaidEnemyInfo') {
        for (const [field, value] of Object.entries(row.values)) {
          const match = /^Is(Armor\w+)(?:PriorityEnchant|BattleScarEffect)$/.exec(field);
          if (!match) continue;
          if (!bool(value)) errors.push(`${label}.${field}: invalid flag`);
          if (!ids.RaidEnemyPartInfo?.has(match[1])) unresolved.push({ table, id: row.id,
            field, value: match[1], target: 'RaidEnemyPartInfo' });
        }
      }
      if (['ServerVarsInfo', 'ServerVarOverride'].includes(table)) {
        if (!row.values.ServerVarsKey?.trim()) errors.push(`${label}: blank server var key`);
        if (table === 'ServerVarOverride' && missing(row.values.Value)) errors.push(`${label}.Value: missing server var value`);
      }
      if (/^TitanScalingInfo(_[ABC])?$/.test(table)) {
        if (!/^[1-9]\d*$/.test(row.values.Stage)) errors.push(`${label}.Stage: invalid positive integer`);
        const sequence = list(row.values.ThemeMultiplierSequence);
        if (!sequence.length || sequence.some(value => !decimal.test(value))) {
          errors.push(`${label}.ThemeMultiplierSequence: invalid multiplier list`);
        }
      }
      if (/^ArtifactCostInfo(_A)?$/.test(table)) {
        for (const field of ['Count', 'RelicCost']) {
          if (!decimal.test(row.values[field] ?? '')) errors.push(`${label}.${field}: invalid decimal`);
        }
      }
      if (table === 'BonusInfo') ref(table, row, 'Combos', 'BonusInfo', true);
      if (table === 'HelperSkillInfo') ref(table, row, 'Owner', 'HelperInfo');
      if (table === 'ClanScrollInfo') ref(table, row, 'ImageMap', 'HelperInfo');
      if (table === 'C_EquipmentInfo') ref(table, row, 'EquipmentSet', 'EquipmentSetInfo');
      if (table === 'ActiveSkillMultiCastInfo') ref(table, row, 'SkillID', 'ActiveSkillInfo');
      if (table === 'ActiveSkillInfo') ref(table, row, 'RequiredTalentID', 'SkillTreeInfo2.0');
      if (table === 'SkillTreeInfo2.0') ref(table, row, 'TalentReq', table);
      if (['TitanResearchInfo', 'GemstoneResearchInfo'].includes(table)) ref(table, row, 'RequiredResearchID', table, true);
      if (table === 'AchievementInfo') {
        const requirements = list(row.values.Requirement), rewards = list(row.values.Reward);
        if (requirements.length !== rewards.length || !requirements.length ||
            [...requirements, ...rewards].some(v => !decimal.test(v))) errors.push(`${label}: achievement tiers mismatch`);
      }
      const cosmetic = cosmeticTables[table];
      if (cosmetic) {
        if (cosmetic.idType) enumRef(table, row, cosmetic.idColumn, cosmetic.idType);
        if (cosmetic.unlockType) enumRef(table, row, cosmetic.unlockColumn, cosmetic.unlockType);
        if (cosmetic.categoryType) enumRef(table, row, cosmetic.categoryColumn, cosmetic.categoryType);
      }
      classifications[table].push(classify(table, row, catalogs));
    }
  }
  // Talent prerequisites are a directed tree. Research adjacency is not treated as a tree.
  const tree = new Map((catalogs['SkillTreeInfo2.0']?.records ?? []).map(r => [r.id, r.values.TalentReq]));
  const finished = new Set(), active = new Set();
  function visit(id) {
    if (active.has(id)) { errors.push(`SkillTreeInfo2.0/${id}: prerequisite cycle`); return; }
    if (finished.has(id) || !tree.has(id)) return;
    active.add(id);
    if (!none(tree.get(id))) visit(tree.get(id));
    active.delete(id); finished.add(id);
  }
  for (const id of tree.keys()) visit(id);
  // Alternate sources are reported side by side; picking one as the live rule needs server evidence.
  const sourceVariants = Object.entries(catalogs).filter(([, data]) => data.variantOfSource)
    .map(([table, data]) => ({ table, ...data.variantOfSource, records: data.records.length,
      baseRecords: catalogs[data.variantOfSource.baseTable]?.records.length ?? null,
      identicalToBase: !data.variantOfSource.added.length && !data.variantOfSource.removed.length
        && !data.variantOfSource.changed.length, runtimeEnabled: false }));
  // Enum members without a catalog row stay listed as evidence; they are never invented into the catalog.
  const cosmeticCoverage = Object.entries(cosmeticTables).filter(([table]) => catalogs[table]).map(([table, spec]) => {
    const members = spec.idType ? Object.keys(cosmeticTypes[spec.idType] ?? {}) : [];
    const tally = column => column ? Object.fromEntries([...(catalogs[table].records.reduce((counts, row) =>
      counts.set(row.values[column], (counts.get(row.values[column]) ?? 0) + 1), new Map()))].sort()) : null;
    return { table, idType: spec.idType ?? null, idTypeNote: spec.idTypeNote ?? null,
      records: catalogs[table].records.length, enumMembers: members.length,
      enumOnly: members.filter(member => !ids[table].has(member)),
      unlockTypes: tally(spec.unlockColumn), categories: tally(spec.categoryColumn),
      activation: 'unverified', runtimeEnabled: false };
  });
  return { version: '8.2.0', runtimeEnabled: false, errors, unresolved, nativeOnly, deferredReferences, rewardReferences, referenceCounts, classifications, cosmeticCoverage, sourceVariants };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = auditCatalogs(loadCatalogs());
  writeFileSync(new URL('validation.json', referenceRoot), JSON.stringify(report) + '\n');
  console.log(JSON.stringify({ errors: report.errors, unresolved: report.unresolved.length, nativeOnly: report.nativeOnly.length,
    checkedReferences: Object.values(report.referenceCounts).reduce((a,b) => a+b, 0) }, null, 2));
  if (report.errors.length || report.unresolved.length) process.exitCode = 1;
}
