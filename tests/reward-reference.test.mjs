import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRewardReference, selectRewardCandidate } from '../tools/reward-reference.mjs';
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
  assert.equal(choice.choiceCount, 1);
  assert.ok(choice.entries.every(e => e.quantity === null));
  assert.equal(parse('Diamonds:100', 'ClanGift').mode, 'clan-gift-list');
  assert.equal(parse('Diamonds:100').mode, 'reward-list');
});

test('native delimiters preserve multiple rewards inside a single choice candidate', () => {
  const choice = parse('Diamonds:100;Equipment:Legendary:1,RaidCard:MoonBeam:20', 'SelectionSlotContents1');
  assert.equal(choice.candidates.length, 2);
  assert.equal(choice.candidates[0].entries.length, 2);
  assert.deepEqual(selectRewardCandidate(choice, -1), []);
  const selected = selectRewardCandidate(choice, 0);
  assert.deepEqual(selected.map(r => r.nativeType), ['Diamonds', 'EquipmentLegendary']);
  assert.equal(selectRewardCandidate(choice, 1)[0].nativeItemId, 'MoonBeam');
  selected[0].quantity = '999';
  assert.equal(choice.candidates[0].entries[0].quantity, '100');
  for (const index of [-2, 2, 0.5, NaN]) assert.throws(() => selectRewardCandidate(choice, index));
  assert.equal(parse('Diamonds:1;SkillPoint:2,Equipment:3').entries.length, 3);
});

test('native value fields distinguish set ID strings, item IDs and rarity-derived types', () => {
  const entries = parse('EquipmentSet:Jade;Pet:Pet1:5;Equipment:Rare:3').entries;
  assert.equal(entries[0].nativeValue, 'Jade');
  assert.equal(entries[0].nativeItemId, '');
  assert.equal(entries[0].quantity, null);
  assert.equal(entries[1].nativeItemId, 'Pet1');
  assert.equal(entries[1].nativeValue, '5');
  assert.equal(entries[2].nativeType, 'EquipmentRare');
  const evidence = JSON.parse(readFileSync(new URL('reward-parser-evidence.json', referenceRoot), 'utf8'));
  assert.deepEqual(evidence.rules.rewardSeparators, [',', ';']);
  assert.equal(evidence.rules.unselectedIndex, -1);
  assert.equal(evidence.rules.selectedIndicesPerSlot, 1);
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
