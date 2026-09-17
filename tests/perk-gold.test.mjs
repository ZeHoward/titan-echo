import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { loadRegister } from '../tools/formula-sources.mjs';

const evidence = JSON.parse(readFileSync(new URL('perk-gold-evidence.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
  assert.match(evidence.binarySha256, /^[0-9a-f]{64}$/);
});

test('關卡的挑法與兩個係數都記下來了', () => {
  const { coefficients } = evidence.stagePick;
  assert.equal(coefficients.makeItRainStageMult.value, 1);
  assert.equal(coefficients.makeItRainMaxStageMult.value, Math.fround(0.85));
  assert.match(evidence.stagePick.formula, /歷史最高 − 目前/);
});

test('金額是「最大金幣來源」開一個略小於 1 的次方，不是關卡的函數', () => {
  assert.match(evidence.payout.formula, /GetLargestGoldSourceAmount/);
  assert.equal(evidence.payout.bonus.name, 'PerkGold');
  const exponent = evidence.payout.exponent.value;
  assert.equal(exponent, Math.fround(0.9965));
  // Just under one: it compresses large numbers rather than scaling them.
  assert.ok(exponent < 1 && exponent > 0.99);
});

test('接不上的原因寫成了具體的依賴清單，不是一句「未還原」', () => {
  const blocked = evidence.blockedBy;
  assert.equal(blocked.method, 'PlayerModel$$GetLargestGoldSourceAmount');
  assert.ok(blocked.instructionCount > 300, `只有 ${blocked.instructionCount} 條就不該說它深`);
  assert.deepEqual(blocked.sources, [
    'MonsterModel$$GetAverageChestersonGoldDrop', 'MonsterModel$$GetAverageBossGoldDrop',
    'FairyController$$GetFairyGoldAmount', 'PetModel$$GetPetHomGold']);
  assert.ok(blocked.alsoNeeds.some(name => name.includes('HandOfMidas')));
  // What was deliberately left unread is named rather than counted.
  assert.equal(evidence.limits.length, 4);
  assert.ok(evidence.limits.some(limit => limit.includes('fcsel')));
});

test('登記表把立即金幣單獨列出來，並指向這份證據', () => {
  const register = loadRegister();
  const perks = register.formulas.find(formula => formula.id === 'perks');
  const gold = perks.parts.find(part => part.part.includes('立即金幣'));
  assert.ok(gold, '立即金幣要有自己的條目');
  assert.equal(gold.status, 'table-differs');
  assert.equal(gold.ref, 'perk-gold-evidence.json');
  assert.match(gold.note, /387 條指令/);
  // The other unrestored perk features stay on their own entry, with their own evidence file.
  const others = perks.parts.find(part => part.part.includes('隨機配發'));
  assert.equal(others.ref, 'perk-evidence.json');
  assert.ok(!others.note.includes('立即金幣'));
});
