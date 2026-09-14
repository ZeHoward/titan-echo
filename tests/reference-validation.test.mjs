import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditCatalogs, classify, loadCatalogs, referenceRoot } from '../tools/reference-validation.mjs';

const catalogs = loadCatalogs();
const report = auditCatalogs(catalogs);
const load = name => JSON.parse(readFileSync(new URL(name + '.json', referenceRoot), 'utf8'));

test('reference audit is reproducible and native-only bonus identities remain distinct from formulas', () => {
  assert.deepEqual(report, load('validation'));
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.unresolved, []);
  // Exact exceptions, not a blanket allowance for a number of missing references.
  assert.ok(report.nativeOnly.every(r => r.formulaStatus === 'unverified'));
  assert.deepEqual(report.nativeOnly.map(r => `${r.table}/${r.id}/${r.field}/${r.value}`).sort(), [
    'EquipmentSetInfo/Mech/BonusType1/PassiveSkillCostReduction',
    'EquipmentSetInfo/Twilight/BonusType1/SorcererPassiveSkillCostReduction',
    'EquipmentSetInfo/MultiCast/BonusType2/AllMultiCastManaCosts',
    'PerkInfo/Doom/BonusTypeA/DoomBonusDamageMax',
    'PerkInfo/Doom/BonusTypeB/DoomBonusTimeUntilMaxDamage',
    'RaidSkillInfo/LimbBurst/BonusTypeA/LimbBurstDamage',
    'RaidSkillInfo/LimbBurst/BonusTypeC/LimbBurstMult',
    'RaidSkillInfo/DecayingAttack/BonusTypeE/DecayHealthCap',
    ...['1', '6', '40', '60'].map(id => `TitanScalingInfo/${id}/BonusTypeA/MonsterHPScaling`),
  ].sort());
});

test('unknown effect IDs fail reference resolution even when other native-only IDs are valid', () => {
  const broken = structuredClone(catalogs);
  broken.ArtifactInfo.records[0].values.BonusType = 'InventedDamage';
  assert.ok(auditCatalogs(broken).unresolved.some(r => r.value === 'InventedDamage'));
  const withoutNative = auditCatalogs(catalogs, {});
  assert.equal(withoutNative.unresolved.length, 12);
});

test('schema validation rejects corrupted decimals, flags, IDs and achievement tiers', () => {
  const broken = structuredClone(catalogs);
  broken.ArtifactInfo.records[0].values.EffectPerLevel = 'Infinity';
  broken.HelperInfo.records[0].values.IsFlying = 'sometimes';
  broken.PetInfo.records[0].id = 'different-pet';
  broken.AchievementInfo.records[0].values.Reward = '5';
  const errors = auditCatalogs(broken).errors;
  assert.ok(errors.some(e => e.includes('invalid decimal')));
  assert.ok(errors.some(e => e.includes('IsFlying: invalid flag')));
  assert.ok(errors.some(e => e.includes('key mismatch')));
  assert.ok(errors.some(e => e.includes('achievement tiers mismatch')));
});

test('broken prerequisite and removed owner references are exposed by their source row', () => {
  const broken = structuredClone(catalogs);
  const row = broken['SkillTreeInfo2.0'].records[0];
  row.values.TalentReq = row.id;
  const owner = broken.HelperSkillInfo.records[0].values.Owner;
  broken.HelperInfo.records = broken.HelperInfo.records.filter(r => r.id !== owner);
  const result = auditCatalogs(broken);
  assert.ok(result.errors.some(e => e.includes('prerequisite cycle')));
  assert.ok(result.unresolved.some(r => r.table === 'HelperSkillInfo' && r.value === owner));
});

test('classification separates fairy, event, raid and explicitly disabled content without enabling it', () => {
  const classified = report.classifications;
  assert.equal(classified.ActiveSkillInfo.filter(r => r.scope === 'fairy-effect').length, 3);
  assert.equal(classified.ActiveSkillInfo.filter(r => r.scope === 'active-skill').length, 11);
  assert.equal(classified.DailyAchievementInfo.find(r => r.id === 'UniqueArtifacts').bundledState, 'disabled');
  assert.equal(classified.EquipmentSetInfo.filter(r => r.scope === 'event-set').length, 56);
  assert.ok(classified.TitanResearchInfo.some(r => r.scope === 'raid'));
  assert.ok(classified.DailyRewardsInfo.every(r => r.scope === 'mixed-event-rewards'));
  assert.ok(classified.PerkInfo.every(r => r.scope === 'unclassified'));
  assert.ok(Object.values(classified).flat().every(r => r.activation === 'unverified' && r.liveAvailability === 'unknown'));
});

test('missing or conflicting availability flags never imply that content is enabled', () => {
  const make = values => classify('Example', { id: 'test', values }, catalogs);
  assert.equal(make({}).bundledState, 'unspecified');
  assert.equal(make({ Enabled: 'TRUE', IsActive: 'FALSE' }).bundledState, 'disabled');
  assert.equal(make({ Enabled: 'FALSE', IsInGame: '1' }).bundledState, 'disabled');
  assert.equal(make({ Enabled: 'TRUE' }).liveAvailability, 'unknown');
});

test('enhancement duplicate resolution retains both source rows and the native last-write result', () => {
  const data = catalogs.C_EquipmentEnhancementScalingInfo;
  const result = data.records.find(r => r.id === 'AllActiveSkillAmount');
  assert.equal(data.records.length, 58);
  assert.equal(data.rowResolution.sourceRows, 59);
  assert.equal(result.values.PowerExp, '1.002');
  assert.equal(result.sourceOrdinal, 57);
  assert.deepEqual(data.rowResolution.duplicateHistory.AllActiveSkillAmount.map(r =>
    [r.sourceOrdinal, r.values.PowerExp]), [[9, '0.4'], [57, '1.002']]);
  assert.equal(load('enhancement-parser-evidence').policy, data.rowResolution.policy);
  assert.deepEqual(load('quarantine').tables, []);
  assert.equal(result.activation, 'unverified');
});
