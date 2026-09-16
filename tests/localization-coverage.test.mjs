import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
const load = name => JSON.parse(readFileSync(new URL(name + '.json', referenceRoot), 'utf8'));
const index = load('localization-index');
const coverage = JSON.parse(readFileSync(new URL('../docs/reference-coverage.json', import.meta.url), 'utf8'));

test('localization files are indexed by key, never by copying their translated text', () => {
  assert.equal(index.role, 'key-coverage-index-only');
  assert.equal(index.files.length, 17);
  assert.equal(index.referenceLanguage, 'LocalizationInfo_English');
  assert.equal(index.referenceKeys, 13122);
  const byName = Object.fromEntries(index.files.map(f => [f.name, f]));
  const languages = index.files.filter(f => f.format === 'json-key-map');
  assert.equal(languages.length, 16);
  for (const file of languages) {
    if (file.name === index.referenceLanguage) continue;
    assert.equal(file.keys, 13114, file.name);
    assert.deepEqual(file.extraKeys, [], file.name);
    assert.equal(file.missingEnglishKeys.length, 8, file.name);
  }
  // The loading screen strings are a per-language column sheet, not a key map.
  assert.equal(byName.LocalizationInfoLoadingScene.format, 'csv-per-language-columns');
  assert.ok(byName.LocalizationInfoLoadingScene.columns.includes('ChineseTrad'));
  // No entry carries any translated value.
  for (const file of index.files) {
    assert.ok(!Object.keys(file).some(key => /value$/i.test(key) && key !== 'emptyValueKeys'));
  }
});

test('the Traditional Chinese gaps V05 has to close are listed by key', () => {
  const chinese = index.files.find(f => f.name === 'LocalizationInfo_ChineseTrad');
  assert.equal(chinese.keys, 13114);
  // Eight English keys have no Traditional Chinese entry at all.
  assert.deepEqual(chinese.missingEnglishKeys, ['AVATAR_UNLOCKED_HolidayThemePark2026', 'Aura_Tortoise',
    'EQUIPMENT_SET_Tortoise', 'Hat_Tortoise', 'REWARD_FORTUNERAIDCARD', 'Slash_Tortoise', 'Suit_Tortoise',
    'Weapon_Tortoise']);
  assert.deepEqual(chinese.emptyValueKeys,
    ['CLAN_HOLIDAY_UPDATE_TIME', 'EQUIPMENT_FARMING_FULL_PER_DAY_TITLE']);
  // 178 more keys still hold the English string, which is the real V05 backlog.
  assert.equal(chinese.untranslatedKeys.length, 178);
  assert.ok(chinese.untranslatedKeys.includes('Weapon_Mech'));
  assert.ok(!chinese.untranslatedKeys.some(key => chinese.emptyValueKeys.includes(key)));
});

test('every bundled resource is accounted for, with non-tables named by format', () => {
  assert.equal(coverage.resources.length, 372);
  assert.equal(coverage.byStatus['not-imported'] ?? 0, 0);
  assert.equal(coverage.byStatus.imported, 133);
  assert.equal(coverage.byStatus['localization-indexed'], 17);
  assert.equal(coverage.byStatus['sample-indexed'], 4);
  assert.equal(coverage.byStatus['atlas-ids-indexed'], 1);
  assert.equal(coverage.byStatus.quarantined, 3);
  assert.equal(coverage.byStatus['not-a-data-table'], 214);
  assert.equal(Object.values(coverage.byStatus).reduce((a, b) => a + b, 0), 372);
  // Non-tables are classified by what the bytes are, not by filename.
  assert.deepEqual(Object.keys(coverage.nonTableKinds).sort(), ['binary-resource', 'bitmap-font-descriptor',
    'headerless-positional-rows', 'json-document', 'single-line-character-list']);
  assert.equal(coverage.nonTableKinds['headerless-positional-rows'], 103);
  assert.ok(coverage.resources.every(r => r.kind));
});

test('the three unimported sheets each carry a reason and their source facts', () => {
  const quarantine = load('quarantine');
  assert.deepEqual(quarantine.tables.map(t => t.table).sort(),
    ['EquipmentTest', 'ScheduledBonusInfo', 'UpdateInfo']);
  for (const entry of quarantine.tables) {
    assert.equal(entry.status, 'not-imported');
    assert.equal(entry.runtimeEnabled, false);
    assert.ok(entry.reason.length > 0, entry.table);
    assert.match(entry.sourceSha256, /^[0-9a-f]{64}$/);
    assert.ok(entry.sourceRows > 0, entry.table);
  }
  const byTable = Object.fromEntries(quarantine.tables.map(t => [t.table, t]));
  assert.equal(byTable.UpdateInfo.sourceRows, 156);
  assert.equal(byTable.EquipmentTest.sourceRows, 6);
  assert.match(byTable.EquipmentTest.evidence, /C_EquipmentInfo/);
  // The resolved list stays separate from the unimported list.
  assert.deepEqual(quarantine.resolved.map(t => t.table).sort(),
    ['C_EquipmentEnhancementScalingInfo', 'ServerVarOverride']);
});
