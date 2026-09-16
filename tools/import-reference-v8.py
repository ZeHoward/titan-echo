"""Build an isolated, lossless numerical catalog; never modify runtime/save data."""
import collections
import csv
import hashlib
import io
import json
import pathlib
import re
from enhancement_reference import TABLE as ENHANCEMENT_TABLE, resolve_enhancements
from servervars_reference import TABLE as SERVERVARS_TABLE, resolve_server_var_overrides

ROOT = pathlib.Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'work/apk-analysis/text-assets'
OUT = ROOT / 'reference/tt2/8.2.0'
TABLES = ['ArtifactInfo', 'ArtifactCostInfo', 'ActiveSkillInfo', 'ActiveSkillMultiCastInfo',
          'SkillTreeInfo2.0', 'EquipmentSetInfo', 'C_EquipmentInfo', 'HelperInfo', 'PetInfo',
          'PassiveSkillInfo', 'HelperSkillInfo', 'BonusInfo', 'DailyRewardsInfo', 'PerkInfo',
          'ClanScrollInfo', 'HelperImprovementsInfo', 'PlayerImprovementsInfo', 'TitanScalingInfo',
          'AchievementInfo', 'DailyAchievementInfo', 'PetQuestLevelInfo',
          'TitanResearchInfo', 'TitanCardInfo',
          'TitanCardUpgradeCostInfo', 'GemstoneResearchInfo', 'HolidayEventTypeInfo',
          'ChallengeTournamentInfo', ENHANCEMENT_TABLE, 'RaidSkillInfo', 'RaidSkillCardCostInfo',
          'RaidPlayerInfo', 'RaidEnemyInfo', 'RaidEnemyPartInfo', 'ShopBundleInfo', 'RaidLevelInfo', 'RaidAreaInfo',
          'GemstoneLevelCost', 'GemstoneRarityInfo', 'GemstoneBonusTypeScalingInfo', 'GemstoneLevelSummonRateInfo',
          'EndgamePetInfo', 'EndgamePetInfo_1', 'EndgameSeasonArtifactInfo', 'EndgameSeasonArtifactInfo_1',
          'EndgameSeasonArtifactCostInfo', 'EndgameSeasonRewardInfo', 'EndgameSeasonRewardInfo_1',
          'AvatarInfo', 'AvatarFrameInfo', 'PlayerTitleInfo',
          'AvatarParticleInfo', 'ProfileBackgroundInfo',
          'ServerVarsInfo', SERVERVARS_TABLE, 'ArtifactCostInfo_A',
          'TitanScalingInfo_A', 'TitanScalingInfo_B', 'TitanScalingInfo_C',
          'RaidCardBoostedSlotInfo', 'RaidCardLevelRewardInfo', 'RaidEnemyEnchantmentInfo',
          'RaidFastCompletionBonusStagesInfo', 'RaidMasterTierFastCompletionBonusStagesInfo',
          'RaidLoyaltyInfo', 'RaidTicketBoostInfo', 'RaidResearchInfo', 'RaidMasterTierLevelInfo',
          'RaidMasterTierRewardInfo', 'RaidMasterTierRewardInfo_1',
          'SoloRaidLevelInfo', 'SoloRaidFarmingLevelInfo',
          'TournamentRewardInfo', 'SuperTournamentRewardInfo', 'NewPlayerTournamentRewardInfo',
          'ChallengeTournamentRewardInfo', 'SuperChallengeTournamentRewardInfo',
          'ChallengeTournamentProgressionRewardInfo', 'ChallengeTournamentArtifactPools',
          'ChallengeTournamentStartingInfo', 'ShopDisplayInfo', 'AdChestInfo', 'NewPrizeInfoDoc',
          'PetParadiseLevelInfo',
          'AnniversaryTournamentRankRewardInfo', 'AnniversaryTournamentSoloContributionRewards',
          'MinigameBallDropRewardInfo', 'MinigameBallDropSoloContributionRewards', 'MinigameBallDropUpgradeInfo',
          'MinigameClanPrestigeGameRewardInfo', 'MinigameClanVaultContributionRewards',
          'MinigameDigsiteLevelInfo', 'MinigameDigsiteRewardInfo', 'MinigameDigsiteTrinketInfo',
          'MinigameEventQuestInfo', 'MinigameFishingDerbyFishInfo', 'MinigameFishingDerbyRarityInfo',
          'MinigameFishingDerbyRewardInfo', 'MinigameFishingDerbySoloContributionRewards',
          'MinigameFishingDerbyUpgradeInfo', 'MinigameFishingDerbyXPInfo', 'MinigameHuntingBeastInfo',
          'MinigameHuntingRarityInfo', 'MinigameHuntingRewardInfo', 'MinigameHuntingSoloContributionRewards',
          'MinigameHuntingUpgradeInfo', 'MinigameMazeRewardInfo', 'MinigameSoloPrestigeGameRewardInfo',
          'GlobalEventInfo', 'GlobalEventTasksInfo', 'HolidayEventCurrencyAmounts',
          'HolidayEventBombGameLevelInfo', 'HolidayEventBombGameRewardInfo',
          'HolidayEventGlobalRaidLevelInfo', 'HolidayEventGlobalRaidRewardInfo',
          'HolidayEventGlobalRaidPartDestroyOrder', 'HolidayEventGlobalRaidSoloContributionRewards',
          'HolidayEventGlobalRaidTargetZoneInfo']
# Shop server-response samples: not gameplay tables, so only their shape is indexed.
SHOP_SAMPLES = ['ShopInfo', 'ShopInfoServerTest', 'ShopInfoServerTest_all_dailyDeals', 'ShopInfoServerTest_copy']
# Composite stable keys where a single source column repeats across rows.
KEYS = {'HelperImprovementsInfo': ['Ascension', 'Level'], 'RaidLevelInfo': ['TierID', 'LevelID'],
        'RaidMasterTierLevelInfo': ['TierID', 'LevelID'], 'SoloRaidLevelInfo': ['WorldID', 'LevelID'],
        'TournamentRewardInfo': ['PrizeID', 'TierID', 'StartRank', 'PrizeType'],
        'SuperTournamentRewardInfo': ['PrizeID', 'TierID', 'StartRank', 'PrizeType'],
        'ChallengeTournamentRewardInfo': ['StartRank', 'PrizeType'],
        'SuperChallengeTournamentRewardInfo': ['StartRank', 'PrizeType'],
        'ChallengeTournamentProgressionRewardInfo': ['TourneyID', 'RewardStage'],
        'NewPrizeInfoDoc': ['PrizeID', 'TierID', 'StartRank', 'PrizeType'],
        'AdChestInfo': ['ChestType', 'Tier', 'RewardCategoryTier', 'RewardTier'],
        'HolidayEventGlobalRaidLevelInfo': ['HolidayEventID', 'Phase'],
        'HolidayEventGlobalRaidRewardInfo': ['HolidayEventID', 'Phase'],
        'HolidayEventGlobalRaidTargetZoneInfo': ['AttackNumber', 'Time', 'TargetPartID']}
# Sheets whose header repeats a column name. Allowed only with the verified InfoDoc column policy.
DUPLICATE_COLUMN_TABLES = {'RaidTicketBoostInfo', 'RaidResearchInfo'}
# Same-shaped alternate sources for a base table. Kept separate; the live choice is not in the package.
VARIANTS = {'ArtifactCostInfo_A': 'ArtifactCostInfo', 'TitanScalingInfo_A': 'TitanScalingInfo',
            'TitanScalingInfo_B': 'TitanScalingInfo', 'TitanScalingInfo_C': 'TitanScalingInfo',
            'EndgamePetInfo_1': 'EndgamePetInfo', 'EndgameSeasonArtifactInfo_1': 'EndgameSeasonArtifactInfo',
            'EndgameSeasonRewardInfo_1': 'EndgameSeasonRewardInfo',
            'RaidMasterTierRewardInfo_1': 'RaidMasterTierRewardInfo',
            'NewPrizeInfoDoc': 'TournamentRewardInfo'}
# Native cosmetic typing: which enum backs each catalog column. None = no native enum for that column.
COSMETIC_TABLES = {
    'AvatarInfo': dict(idColumn='AvatarID', idType='AvatarID', unlockColumn='AvatarUnlockType', unlockType='AvatarUnlockType'),
    'AvatarFrameInfo': dict(idColumn='AvatarFrameID', idType='AvatarFrameId', unlockColumn='UnlockType', unlockType='AvatarUnlockType'),
    'AvatarParticleInfo': dict(idColumn='AvatarParticleID', idType='AvatarParticleID', unlockColumn='UnlockType', unlockType='AvatarUnlockType'),
    'PlayerTitleInfo': dict(idColumn='TitleID', idType=None, idTypeNote='native TitleID is int, not an enum',
                            unlockColumn='TitleUnlockType', unlockType='AvatarUnlockType'),
    'ProfileBackgroundInfo': dict(idColumn='ProfileBackgroundID', idType=None, idTypeNote='native ID is a plain string',
                                  unlockColumn=None, unlockType=None,
                                  categoryColumn='ProfileBackgroundType', categoryType='ProfileBackgroundType'),
}
COSMETIC_ENUMS = ['AvatarID', 'AvatarFrameId', 'AvatarParticleID', 'AvatarUnlockType', 'ProfileBackgroundType']
COSMETIC_MEMBERS = [
    ('AvatarParticleInfo', 'public static bool TryParse(InfoDoc infoDoc, int row, out AvatarParticleInfo info)'),
    ('AvatarParticleModel', 'private void ParseAvatarParticleInfo()'),
    ('ProfileBackgroundModel', 'private void ParseProfileBackgroundInfo()'),
    ('ProfileBackgroundModel', 'public List<ProfileBackgroundInfo> GetProfileBackgroundInfos(ProfileBackgroundType backgroundType)'),
    ('ProfileBackgroundModel', 'public void SetProfileBackgrounds(string playerBackgroundID, string raidBackgroundID)'),
]
OMIT = {'Name', 'Note', 'Notes', 'Description', 'PetName', 'NameColor', 'BonusIcon', 'TextSpriteIndex',
        'Color', 'EnchantColor', 'BestAgainst', 'Title', 'LongDescription', 'CatchDescription',
        'MissedDescription', 'BundleImageOverride', 'BgColor', 'BgColorSecondary', 'BannerPrefabPath',
        'CatchDescColor', 'GlowColor', 'BorderColor', 'OverlayColor', 'FogBackMin', 'FogBackMax',
        'FogFrontMin', 'FogFrontMax', 'LeaderboardPosition', 'IncrementBgColor', 'TextColor', 'TourneyType'}
DECIMAL = re.compile(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\Z')

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def enum_values(text, name):
    rows = re.findall(r'public const ' + name + r' (\w+) = (-?\d+);', text)
    if not rows or len(dict(rows)) != len(rows):
        raise ValueError(f'missing or duplicate native {name} members')
    return dict(rows)

def native_rva(text, signature):
    marker = r'\t// RVA: (0x[0-9A-Fa-f]+)[^\n]*\n\t' + re.escape(signature) + r' \{ \}'
    found = re.findall(marker, text)
    if len(found) != 1:
        raise ValueError(f'native member not uniquely located: {signature}')
    return found[0]

def parse(path):
    reader = csv.DictReader(io.StringIO(path.read_text(encoding='utf-8-sig')))
    fields = reader.fieldnames
    if not fields:
        raise ValueError(f'{path.name}: missing columns')
    rows = list(reader)
    if any(None in r or None in r.values() for r in rows):
        raise ValueError(f'{path.name}: malformed row')
    return fields, [{k: v.strip() for k, v in r.items()} for r in rows]

def key(row, keys):
    parts = [row[k] for k in keys]
    if any(p in ('', '-') for p in parts):
        raise ValueError('missing stable ID')
    return parts[0] if len(parts) == 1 else json.dumps(parts, separators=(',', ':'))

def index(rows, keys):
    result = {}
    for row in rows:
        identity = key(row, keys)
        if identity in result:
            raise ValueError(f'duplicate stable ID: {identity}')
        result[identity] = row
    return result

def write(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8', newline='\n')

def main():
    audit = json.loads((ROOT / 'docs/reference-baseline.json').read_text())
    if sha(ROOT / 'work/apk-analysis/tap-titans-2-8.2.0.xapk') != audit['package']['sha256']:
        raise ValueError('APK hash mismatch')
    pinned = {r['table']: r['apkTextSha256'] for r in audit['tables']}
    # The previous full resource inventory also pins tables first parsed in this run.
    inventory_path = OUT / 'manifest.json'
    inventory = json.loads(inventory_path.read_text()) if inventory_path.exists() else {}
    resource_pins = {r['name']: r['sha256'] for r in inventory.get('resourceIndex', [])}
    evidence = json.loads((OUT/'enhancement-parser-evidence.json').read_text())
    if (evidence['packageSha256'] != audit['package']['sha256'] or
        evidence['policy'] != 'last-successfully-parsed-row-wins' or
        evidence['binarySha256'] != sha(ROOT/'work/apk-analysis/libil2cpp.so')):
        raise ValueError('enhancement parser evidence mismatch')
    infodoc_evidence = json.loads((OUT/'infodoc-parser-evidence.json').read_text())
    if (infodoc_evidence['packageSha256'] != audit['package']['sha256'] or
        infodoc_evidence['columnPolicy'] != 'last-header-index-wins' or
        infodoc_evidence['binarySha256'] != sha(ROOT/'work/apk-analysis/libil2cpp.so')):
        raise ValueError('InfoDoc parser evidence mismatch')
    server_evidence = json.loads((OUT/'servervars-parser-evidence.json').read_text())
    if (server_evidence['packageSha256'] != audit['package']['sha256'] or
        server_evidence['policy'] != 'last-parsed-row-wins' or
        server_evidence['binarySha256'] != sha(ROOT/'work/apk-analysis/libil2cpp.so')):
        raise ValueError('server var parser evidence mismatch')
    known_bonuses = json.loads((OUT/'native-bonus-types.json').read_text())['values']
    OUT.mkdir(parents=True, exist_ok=True)
    manifest, catalogs, retained_columns = [], {}, {}
    for table in TABLES:
        paths = list(ASSETS.glob('*_' + table + '.txt'))
        if len(paths) != 1:
            raise ValueError(f'{table}: expected exactly one source')
        path = paths[0]
        if path.name in resource_pins and sha(path) != resource_pins[path.name]:
            raise ValueError(f'{table}: indexed resource hash mismatch')
        if table in pinned and sha(path) != pinned[table]:
            raise ValueError(f'{table}: source hash mismatch')
        fields, rows = parse(path)
        repeated = sorted(name for name, count in collections.Counter(fields).items() if count > 1)
        columns = None
        if repeated:
            if table not in DUPLICATE_COLUMN_TABLES:
                raise ValueError(f'{table}: duplicate columns {repeated}')
            raw = list(csv.reader(io.StringIO(path.read_text(encoding='utf-8-sig'))))[1:]
            # The shadowed column is unreachable by name natively, so keep its cells beside the effective one.
            columns = dict(policy=infodoc_evidence['columnPolicy'], evidence='infodoc-parser-evidence.json',
                repeated=[dict(column=name, sourceIndexes=[i for i, f in enumerate(fields) if f == name],
                               effectiveIndex=max(i for i, f in enumerate(fields) if f == name),
                               shadowed=[dict(sourceIndex=i, values=[row[i].strip() for row in raw])
                                         for i in [j for j, f in enumerate(fields) if f == name][:-1]])
                          for name in repeated])
        keys = KEYS.get(table, [fields[0]])
        resolution = None
        if table == ENHANCEMENT_TABLE:
            if sha(path) != evidence['sourceSha256']:
                raise ValueError('enhancement source differs from verified parser evidence')
            indexed, source_ordinals, duplicate_history = resolve_enhancements(table, rows, known_bonuses)
            resolution = dict(policy=evidence['policy'], evidence='enhancement-parser-evidence.json',
                sourceRows=len(rows), effectiveRows=len(indexed), duplicateHistory=duplicate_history)
        elif table in server_evidence['sourceSha256']:
            if sha(path) != server_evidence['sourceSha256'][table]:
                raise ValueError(f'{table}: source differs from verified parser evidence')
            if table == SERVERVARS_TABLE:
                indexed, source_ordinals, duplicate_history = resolve_server_var_overrides(table, rows)
                resolution = dict(policy=server_evidence['policy'], evidence='servervars-parser-evidence.json',
                    sourceRows=len(rows), effectiveRows=len(indexed), duplicateHistory=duplicate_history)
            else:
                indexed = index(rows, keys)
                source_ordinals = {identity: ordinal for ordinal, identity in enumerate(indexed)}
        else:
            indexed = index(rows, keys)
            source_ordinals = {identity: ordinal for ordinal, identity in enumerate(indexed)}
        retained = list(dict.fromkeys(f for f in fields if f not in OMIT))
        schema = {}
        for field in retained:
            values = {r[field] for r in rows} - {'', '-'}
            kind = 'identifier' if field in keys else ('boolean' if values and all(v.lower() in ('true', 'false') for v in values) else 'decimal' if values and all(DECIMAL.fullmatch(v) for v in values) else 'token')
            schema[field] = kind
        records = []
        for ordinal, (identity, row) in enumerate(indexed.items()):
            # Preserve missing-cell distinctions and every decimal lexeme, even > 1e308.
            values = {f: row[f] for f in retained}
            flags = {f: row[f] for f in ('Enabled', 'IsInGame', 'IsActive', 'LimitedTime', 'SkillType', 'SetType', 'Type') if f in row}
            records.append(dict(id=identity, sourceOrdinal=source_ordinals[identity], values=values,
                                availabilityEvidence=flags, activation='unverified', verification='pending'))
        variant = None
        if table in VARIANTS:
            base = catalogs.get(VARIANTS[table])
            if base is None:
                raise ValueError(f'{table}: base source {VARIANTS[table]} must be imported first')
            # Compare retained columns only; omitted name and colour columns are not part of the catalog.
            columns_here, columns_base = set(schema), set(retained_columns[VARIANTS[table]])
            shared = columns_here & columns_base
            variant = dict(baseTable=VARIANTS[table], liveSelection='unknown',
                sharedColumns=sorted(shared), variantOnlyColumns=sorted(columns_here - columns_base),
                baseOnlyColumns=sorted(columns_base - columns_here),
                added=sorted(indexed.keys()-base.keys()), removed=sorted(base.keys()-indexed.keys()),
                changed=sorted(k for k in indexed.keys() & base.keys() if any(indexed[k][f] != base[k][f] for f in shared)))
        old = ROOT / 'work/tt2-csv/csv' / (table + '.csv')
        diff = None
        if old.exists() and table not in (ENHANCEMENT_TABLE, SERVERVARS_TABLE):
            old_fields, old_rows = parse(old)
            before = index(old_rows, keys)
            shared = set(fields) & set(old_fields) - OMIT
            diff = dict(added=sorted(indexed.keys()-before.keys()), removed=sorted(before.keys()-indexed.keys()),
                        changed=sorted(k for k in indexed.keys() & before.keys() if any(indexed[k][f] != before[k][f] for f in shared)),
                        addedColumns=sorted(set(fields)-set(old_fields)), removedColumns=sorted(set(old_fields)-set(fields)))
        data = dict(version='8.2.0', table=table, keys=keys, schema=schema, omittedColumns=sorted(set(fields)&OMIT),
                    missingValues=['', '-'], records=records, differenceFrom75=diff)
        if columns:
            data['columnResolution'] = columns
        if variant:
            data['variantOfSource'] = variant
        if resolution:
            data['rowResolution'] = resolution
            data['differenceFrom75Status'] = 'not-compared: historical parser duplicate policy not verified'
        write(table + '.json', data)
        catalogs[table] = indexed
        retained_columns[table] = retained
        manifest.append(dict(table=table, rows=len(indexed), sourceSha256=sha(path), catalogSha256=sha(OUT/(table+'.json'))))
    legacy = {}
    source = (ROOT / 'lib/tt2-data.ts').read_text(encoding='utf-8')
    mapping = dict(TT2_ARTIFACTS='ArtifactInfo', TT2_ACTIVE='ActiveSkillInfo', TT2_TREE='SkillTreeInfo2.0',
                   TT2_SETS='EquipmentSetInfo', TT2_HEROES='HelperInfo', TT2_PETS='PetInfo', TT2_GEAR='C_EquipmentInfo')
    for name, body in re.findall(r'export const (TT2_\w+) = (.*);', source):
        if name not in mapping:
            continue
        rows = json.loads(body)
        ids = [r['id'] for r in rows]
        if len(set(ids)) != len(ids):
            raise ValueError(f'{name}: duplicate legacy ID')
        target = catalogs[mapping[name]]
        legacy[name] = dict(table=mapping[name], entries=[dict(legacyIndex=i, id=v, targetId=v if v in target else None) for i,v in enumerate(ids)])
    write('legacy-2.6.json', dict(runtimeSourceSha256=sha(ROOT/'lib/tt2-data.ts'), catalogs=legacy))
    dump_path = ROOT / 'work/apk-analysis/dump/dump.cs'
    dump_text = dump_path.read_text(encoding='utf-8')
    # Scheduled bonuses are built from a server dictionary, so the bundled sheet is not an authoritative table.
    scheduled_path = next(ASSETS.glob('*_ScheduledBonusInfo.txt'))
    scheduled_fields, scheduled_rows = parse(scheduled_path)
    scheduled_members = ['public virtual bool TryParse(Dictionary<string, object> bonusDict, string bonusKey)',
                         'private void ParseAllBonuses(Dictionary<string, object> infoDict)']
    write('quarantine.json', dict(tables=[dict(table='ScheduledBonusInfo', status='not-imported',
          reason='no InfoDoc row parser; the client builds scheduled bonuses from a server dictionary',
          sourceSha256=sha(scheduled_path), sourceRows=len(scheduled_rows),
          rowsWithKey=sum(1 for r in scheduled_rows if r[scheduled_fields[0]]),
          noteOnlyRows=sum(1 for r in scheduled_rows if not r[scheduled_fields[0]]),
          nativeMembers=[dict(signature=m, rva=native_rva(dump_text, m)) for m in scheduled_members],
          blockedBy='live schedule payload unavailable', runtimeEnabled=False)],
          resolved=[dict(table=ENHANCEMENT_TABLE,
          reason='native-overwrite-policy-verified', evidence='enhancement-parser-evidence.json',
          historyLocation=ENHANCEMENT_TABLE+'.json#rowResolution', runtimeEnabled=False),
          dict(table=SERVERVARS_TABLE, reason='native-last-parsed-row-policy-verified',
          evidence='servervars-parser-evidence.json',
          historyLocation=SERVERVARS_TABLE+'.json#rowResolution', runtimeEnabled=False)]))
    native_path = OUT / 'native-bonus-types.json'
    if native_path.exists():
        native_pins = json.loads(native_path.read_text())
        if sha(dump_path) != native_pins['dumpSha256'] or sha(ROOT/'work/apk-analysis/global-metadata.dat') != native_pins['metadataSha256']:
            raise ValueError('native BonusType evidence hash mismatch')
    enum_rows = re.findall(r'public const BonusType (\w+) = (-?\d+);', dump_text)
    if not enum_rows or len(dict(enum_rows)) != len(enum_rows):
        raise ValueError('missing or duplicate native BonusType IDs')
    write('native-bonus-types.json', dict(version='8.2.0',
          metadataSha256=sha(ROOT/'work/apk-analysis/global-metadata.dat'),
          dumpSha256=sha(dump_path), packageSha256=audit['package']['sha256'],
          type='BonusType', values=dict(enum_rows),
          evidenceScope='Enum identity only; not a formula, enabled flag or live server value'))
    reward_ids = dict(re.findall(r'public const RewardID (\w+) = (-?\d+);', dump_text))
    # Server var sheet keys bind to these attributed static fields by name.
    server_var_fields = re.findall(r'\[ServerVar\("[^"]*"\)\]\n\tpublic static [\w<>.\[\],? ]+? (\w+);', dump_text)
    if not server_var_fields or len(set(server_var_fields)) != len(server_var_fields):
        raise ValueError('missing or duplicate native ServerVar fields')
    write('native-server-var-fields.json', dict(version='8.2.0', attribute='ServerVar',
          fields=sorted(server_var_fields), dumpSha256=sha(dump_path),
          metadataSha256=sha(ROOT/'work/apk-analysis/global-metadata.dat'),
          evidenceScope='Field identity only; not a value, default or live server payload'))
    write('native-reward-types.json', dict(version='8.2.0', values=reward_ids,
          dumpSha256=sha(dump_path), metadataSha256=sha(ROOT/'work/apk-analysis/global-metadata.dat'),
          evidenceScope='RewardID identity only; reward grammar and delivery behavior require separate verification'))
    write('native-cosmetic-types.json', dict(version='8.2.0',
          packageSha256=audit['package']['sha256'], dumpSha256=sha(dump_path),
          metadataSha256=sha(ROOT/'work/apk-analysis/global-metadata.dat'),
          types={name: enum_values(dump_text, name) for name in COSMETIC_ENUMS},
          tableTypes=COSMETIC_TABLES,
          nativeMembers=[dict(type=owner, signature=signature, rva=native_rva(dump_text, signature))
                         for owner, signature in COSMETIC_MEMBERS],
          evidenceScope='Enum identity, column typing and method addresses only; not unlock rules, live availability, purchase or reward delivery'))
    write('manifest.json', dict(version='8.2.0', packageSha256=audit['package']['sha256'], runtimeEnabled=False,
                               tables=manifest, resourceIndex=[dict(name=p.name, sha256=sha(p), bytes=p.stat().st_size,
                               parsed=any(p.name.endswith('_'+t+'.txt') for t in TABLES)) for p in sorted(ASSETS.glob('*.txt'))]))
    # Shop payload samples, including the ones that are not even strict JSON, are shape-indexed only.
    samples = []
    for name in SHOP_SAMPLES:
        path = next(ASSETS.glob('*_' + name + '.txt'))
        if sha(path) != resource_pins[path.name]:
            raise ValueError(f'{name}: indexed resource hash mismatch')
        text = path.read_text(encoding='utf-8-sig')
        try:
            payload = json.loads(text)
            sections = sorted(payload) if isinstance(payload, dict) else None
            product_types = sorted({p.get('product_type') for section in (payload.values() if isinstance(payload, dict) else [])
                                    if isinstance(section, dict) for p in section.get('products', [])
                                    if isinstance(p, dict) and p.get('product_type')})
            status = 'strict-json'
        except json.JSONDecodeError as error:
            sections, product_types, status = None, [], f'not-strict-json: {error.msg} at line {error.lineno}'
        samples.append(dict(name=name, sourceSha256=sha(path), bytes=path.stat().st_size,
            status=status, topLevelSections=sections, productTypes=product_types,
            role='shop-server-response-sample', runtimeEnabled=False,
            limits='test fixture shape only; not a live shop listing, price, schedule or daily delivery source'))
    write('shop-payload-samples.json', dict(version='8.2.0', packageSha256=audit['package']['sha256'], samples=samples))
    layout_path = next(ASSETS.glob('*_RaidEnemyLayout.txt'))
    if sha(layout_path) != resource_pins[layout_path.name]:
        raise ValueError('raid atlas source changed')
    layout = json.loads(layout_path.read_text(encoding='utf-8'))
    if not isinstance(layout.get('frames'), dict) or not isinstance(layout.get('meta'), dict):
        raise ValueError('raid atlas schema changed')
    write('raid-layout-index.json', dict(sourceSha256=sha(layout_path), sourceFormat='sprite-atlas-json',
          role='visual-resource-not-raid-level-data', frameIds=sorted(layout['frames']),
          omitted='images, coordinates and other atlas content', runtimeEnabled=False))
    print(f'Imported {len(manifest)} tables, {sum(t["rows"] for t in manifest)} records; runtime unchanged')

if __name__ == '__main__':
    main()
