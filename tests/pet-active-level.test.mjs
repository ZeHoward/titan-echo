import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { fresh, hydrate, stateEffect } from '../lib/engine.ts';
import { petBonus, TT2_SETS, TT2_TREE, bonusDefinitions } from '../lib/tt2-rules.ts';
import { TT2_PETS } from '../lib/tt2-data.ts';

const evidence = JSON.parse(readFileSync(new URL('pet-active-level-evidence.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));
const samurai = TT2_SETS.findIndex(s => s.id === 'Samurai');

function save({ sets = [], level = 60, active = [0, 1] } = {}) {
  const s = hydrate(fresh(1000));
  s.tt2.petLevels = s.tt2.petLevels.map(() => level);
  s.tt2.activePets = active;
  s.tt2.sets = sets;
  return s;
}

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
});

test('原生回傳的是額外等級，而且會無條件捨去', () => {
  assert.match(evidence.expression, /擁有等級 \+ floor\(擁有等級 × ActivePetLevel\)/);
  assert.equal(evidence.bonus, 'ActivePetLevel');
  assert.equal(bonusDefinitions.ActivePetLevel.additive, true);
});

test('沒有來源時出戰寵物的加成不變', () => {
  const s = save();
  assert.equal(stateEffect(s, 'ActivePetLevel'), 0);
  const plain = save({ sets: [] });
  for (const i of [0, 1]) assert.equal(petBonus(s.tt2, i), petBonus(plain.tt2, i));
});

test('武士套裝讓出戰寵物等於多了四分之一的等級', () => {
  const plain = save(), boosted = save({ sets: [samurai] });
  const raise = stateEffect(boosted, 'ActivePetLevel');
  assert.ok(raise > 0);
  // 60 級 + floor(60 × 0.25) = 75 級，拿一個真的 75 級的存檔來比對。
  const effective = save({ level: 60 + Math.floor(60 * raise) });
  for (const i of [0, 1]) {
    assert.equal(petBonus(boosted.tt2, i), petBonus(effective.tt2, i),
      `出戰寵物 ${i} 應該等同於 ${60 + Math.floor(60 * raise)} 級`);
    assert.ok(petBonus(boosted.tt2, i) !== petBonus(plain.tt2, i), '應該真的有差');
  }
});

test('沒有出戰的寵物完全不受影響', () => {
  const plain = save(), boosted = save({ sets: [samurai] });
  for (let i = 2; i < TT2_PETS.length; i++) {
    assert.equal(petBonus(boosted.tt2, i), petBonus(plain.tt2, i), `寵物 ${i} 沒出戰就不該變`);
  }
});

test('捨去是真的捨去：等級乘出小數時不會多給', () => {
  const ninetails = TT2_SETS.findIndex(s => s.id === 'Ninetails');
  const boosted = save({ level: 7, sets: [ninetails] });          // 7 × 0.1 = 0.7 → 0 級
  const same = save({ level: 7 });
  for (const i of [0, 1]) assert.equal(petBonus(boosted.tt2, i), petBonus(same.tt2, i),
    '不足一級就不該有任何變化');
  const enough = save({ level: 10, sets: [ninetails] });          // 10 × 0.1 = 1 → 1 級
  const eleven = save({ level: 11 });
  for (const i of [0, 1]) assert.equal(petBonus(enough.tt2, i), petBonus(eleven.tt2, i));
});

test('三個來源都拿得到，不是擺著看的', () => {
  const craftable = ['Mythic', 'Legendary', 'Rare'];
  for (const id of ['Samurai', 'Ninetails']) {
    const set = TT2_SETS.find(s => s.id === id);
    assert.ok(craftable.includes(set.rarity), `${id} 要在 craftSet 收的稀有度裡`);
  }
  assert.ok(TT2_TREE.some(k => JSON.stringify(k.effects || []).includes('"ActivePetLevel"')),
    '天賦那個來源也要還在');
});
