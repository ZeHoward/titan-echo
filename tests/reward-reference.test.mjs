import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRewardReference } from '../tools/reward-reference.mjs';
import { auditCatalogs, loadCatalogs, referenceRoot } from '../tools/reference-validation.mjs';
const catalogs = loadCatalogs();
const native = JSON.parse(readFileSync(new URL('native-reward-types.json', referenceRoot), 'utf8')).values;
const parse = (text, field = 'RewardString') => parseRewardReference(text, field, catalogs, native);

test('reward amounts preserve exact strings, repeated types and item qualifiers', () => {
  const result = parse('Equipment:7,Equipment:Rare:3,RaidCard:MoonBeam:250,Diamonds:9007199254740993');
  assert.deepEqual(result.entries.map(e => e.quantity), ['7', '3', '250', '9007199254740993']);
  assert.equal(result.entries[1].qualifier, 'Rare');
  assert.equal(result.entries[2].itemId, 'MoonBeam');
  assert.equal(result.entries[2].target, 'RaidSkillInfo');
  assert.equal(result.runtimeEnabled, false);
});

test('choice candidates and clan gifts remain distinct from automatic rewards', () => {
  const choice = parse('EquipmentSet:Blacksmith,EquipmentSet:Jade', 'SelectionSlotContents1');
  assert.equal(choice.mode, 'choice-candidates');
  assert.equal(choice.choiceCount, null);
  assert.ok(choice.entries.every(e => e.quantity === null));
  assert.equal(parse('Diamonds:100', 'ClanGift').mode, 'clan-gift-list');
  assert.equal(parse('Diamonds:100').mode, 'reward-list');
});

test('unsupported grammar and missing item IDs fail instead of dropping or guessing rewards', () => {
  for (const text of ['Diamonds:-1', 'Diamonds:NaN', 'Diamonds:1.5', 'Diamonds:2,',
    'UnknownResource:1', 'RaidCard:Missing:1', 'EquipmentSet:Missing', 'Equipment:MadeUp:1',
    'Pet:MissingPet:1', 'RaidCard:MoonBeam:1:extra']) {
    assert.throws(() => parse(text), undefined, text);
  }
  assert.throws(() => parse('Diamonds:1', 'DailyDeliveryID'));
});

test('all 510 bundled reward fields parse but delivery schedules remain explicitly unresolved', () => {
  const report = auditCatalogs(catalogs);
  assert.deepEqual(report.errors, []);
  assert.equal(report.rewardReferences.length, 510);
  assert.equal(report.deferredReferences.length, 3);
  assert.ok(report.deferredReferences.every(r => r.field === 'DailyDeliveryID'));
  assert.ok(report.rewardReferences.every(r => r.deliveryRules === 'unverified' && r.runtimeEnabled === false));
  const broken = structuredClone(catalogs);
  broken.ShopBundleInfo.records[0].values.RewardString = 'EquipmentSet:Missing';
  assert.ok(auditCatalogs(broken).errors.some(e => e.includes('unknown EquipmentSetInfo ID')));
});
