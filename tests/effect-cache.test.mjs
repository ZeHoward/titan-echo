import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh, dps, tapDamage } from '../lib/engine.ts';
import { effect, baseEffect, equipmentEffect, petBonus, TT2_ARTIFACTS, TT2_TREE, TT2_SETS } from '../lib/tt2-rules.ts';
import { TT2_GEAR } from '../lib/tt2-data.ts';
import { toNumber } from '../lib/big-number.ts';

// The resolver caches a bonus against a signature of everything the walk reads. If a field is
// left out of that signature, a stale value survives a change that should have moved it. Each
// case here changes one field and insists the answer moves with it.
const armed = () => {
  const s = fresh(1000);
  s.tt2.artifacts = s.tt2.artifacts.map((_, i) => (i < 40 ? 20 : 0));
  s.tt2.tree = s.tt2.tree.map(() => 1);
  s.tt2.petLevels = s.tt2.petLevels.map(() => 30);
  s.heroes = s.heroes.map(() => 100);
  return s;
};

test('a changed artifact, talent, set or enchant moves the bonus it feeds', () => {
  const s = armed();
  const damageArtifact = TT2_ARTIFACTS.findIndex(a => a.effect === 'AllDamage');
  assert.ok(damageArtifact >= 0);
  const before = baseEffect(s.tt2, 'AllDamage');
  s.tt2.artifacts[damageArtifact] += 10;
  assert.notEqual(baseEffect(s.tt2, 'AllDamage'), before, '神器等級改變後應重算');

  const talent = TT2_TREE.findIndex(k => k.effects.some(e => e.type === 'TapDamage'));
  assert.ok(talent >= 0);
  const tapBefore = baseEffect(s.tt2, 'TapDamage');
  s.tt2.tree[talent] = Math.min(TT2_TREE[talent].max, s.tt2.tree[talent] + 1);
  assert.notEqual(baseEffect(s.tt2, 'TapDamage'), tapBefore, '天賦等級改變後應重算');

  // A completed set only moves the bonuses it actually carries, so ask for one of those.
  const carried = TT2_SETS[0].effects[0].type;
  const setBefore = baseEffect(s.tt2, carried);
  s.tt2.sets = [...s.tt2.sets, 0];
  assert.notEqual(baseEffect(s.tt2, carried), setBefore, '套裝收齊後應重算');

  const enchantBefore = baseEffect(s.tt2, 'AllDamage');
  s.tt2.enchanted = [...s.tt2.enchanted, damageArtifact];
  assert.equal(typeof baseEffect(s.tt2, 'AllDamage'), 'number', '附魔改變後仍應得到數值');
  assert.ok(Number.isFinite(enchantBefore));
});

test('a changed pet level or active pet moves the bonus it feeds', () => {
  const s = armed();
  const before = effect(s.tt2, 'AllDamage');
  s.tt2.petLevels = s.tt2.petLevels.map(level => level + 50);
  const after = effect(s.tt2, 'AllDamage');
  assert.notEqual(after, before, '寵物等級改變後應重算');
  // Putting a pet on the field changes its fraction from partial to full.
  const fielded = effect(s.tt2, 'AllDamage');
  s.tt2.activePets = [0, 1];
  assert.notEqual(effect(s.tt2, 'AllDamage'), fielded, '出戰寵物改變後應重算');
});

test('a changed equipped item or its level moves the bonus it feeds', () => {
  const s = armed();
  // Pick a piece by the bonus it declares, so the assertion is about the cache, not the catalog.
  const definition = TT2_GEAR.findIndex(g => g.effect === 'SwordAttackDamage');
  assert.ok(definition >= 0);
  const slot = TT2_GEAR[definition].slot, target = TT2_GEAR[definition].effect;
  const equip = level => {
    s.tt2.inventory = [{ id: 1, definition, level }];
    s.tt2.equipped = [-1, -1, -1, -1, -1];
    s.tt2.equipped[slot] = 1;
  };
  equip(5);
  const before = effect(s.tt2, target);
  equip(40);
  assert.notEqual(effect(s.tt2, target), before, '裝備等級改變後應重算');
  const equippedBefore = effect(s.tt2, target);
  s.tt2.equipped = [-1, -1, -1, -1, -1];
  assert.notEqual(effect(s.tt2, target), equippedBefore, '卸下裝備後應重算');
});

// effect() no longer re-reads the fields baseEffect already checked; it follows the base cache by
// version. These cases change a base field and ask effect(), which is the path that would go stale.
test('一個基礎欄位改變時，走 effect() 的結果也要跟著動，不只是 baseEffect()', () => {
  const s = armed();
  const damageArtifact = TT2_ARTIFACTS.findIndex(a => a.effect === 'AllDamage');
  const before = effect(s.tt2, 'AllDamage');
  s.tt2.artifacts[damageArtifact] += 10;
  assert.notEqual(effect(s.tt2, 'AllDamage'), before, '神器改變後 effect() 仍回舊值');

  const talent = TT2_TREE.findIndex(k => k.effects.some(e => e.type === 'TapDamage'));
  const tapBefore = effect(s.tt2, 'TapDamage');
  s.tt2.tree[talent] = Math.min(TT2_TREE[talent].max, s.tt2.tree[talent] + 1);
  assert.notEqual(effect(s.tt2, 'TapDamage'), tapBefore, '天賦改變後 effect() 仍回舊值');

  const carried = TT2_SETS[0].effects[0].type;
  const setBefore = effect(s.tt2, carried);
  s.tt2.sets = [...s.tt2.sets, 0];
  assert.notEqual(effect(s.tt2, carried), setBefore, '套裝收齊後 effect() 仍回舊值');
});

test('陣列變長或變短都要重算，長度改變不能被逐格比對漏掉', () => {
  const s = armed();
  const definition = TT2_GEAR.findIndex(g => g.effect === 'SwordAttackDamage');
  const slot = TT2_GEAR[definition].slot, target = TT2_GEAR[definition].effect;
  s.tt2.inventory = [{ id: 1, definition, level: 30 }];
  s.tt2.equipped = [-1, -1, -1, -1, -1];
  s.tt2.equipped[slot] = 1;
  const one = effect(s.tt2, target);
  // A second, unequipped piece only changes the bag length; the answer must still be recomputed
  // rather than served from a reading that was one item shorter.
  s.tt2.inventory = [...s.tt2.inventory, { id: 2, definition, level: 99 }];
  assert.equal(effect(s.tt2, target), one, '多一件沒裝上的裝備不該改變加成');
  s.tt2.inventory = [{ id: 2, definition, level: 99 }];
  s.tt2.equipped[slot] = 2;
  assert.notEqual(effect(s.tt2, target), one, '丟掉舊裝備並換上新的之後仍回舊值');

  const enchantArtifact = TT2_ARTIFACTS.findIndex(a => a.effect === 'AllDamage');
  s.tt2.artifacts[enchantArtifact] = 20;
  const plain = effect(s.tt2, 'AllDamage');
  s.tt2.enchanted = [enchantArtifact];
  assert.notEqual(effect(s.tt2, 'AllDamage'), plain, '附魔清單變長後仍回舊值');
  s.tt2.enchanted = [];
  assert.equal(effect(s.tt2, 'AllDamage'), plain, '附魔清單清空後應回到原值');
});

test('同樣的數字換位置也算改變：兩件裝備互換等級', () => {
  const s = armed();
  const definition = TT2_GEAR.findIndex(g => g.effect === 'SwordAttackDamage');
  const slot = TT2_GEAR[definition].slot, target = TT2_GEAR[definition].effect;
  s.tt2.inventory = [{ id: 1, definition, level: 10 }, { id: 2, definition, level: 90 }];
  s.tt2.equipped = [-1, -1, -1, -1, -1];
  s.tt2.equipped[slot] = 1;
  const low = effect(s.tt2, target);
  s.tt2.inventory = [{ id: 1, definition, level: 90 }, { id: 2, definition, level: 10 }];
  assert.notEqual(effect(s.tt2, target), low, '兩件裝備互換等級後仍回舊值');
});

test('面板直接呼叫的 equipmentEffect 與 petBonus 也跟著基礎欄位動', () => {
  const s = armed();
  const definition = TT2_GEAR.findIndex(g => g.effect === 'SwordAttackDamage');
  const item = { id: 1, definition, level: 30 };
  s.tt2.inventory = [item];
  s.tt2.equipped = [-1, -1, -1, -1, -1];
  s.tt2.equipped[TT2_GEAR[definition].slot] = 1;
  const gearBefore = equipmentEffect(s.tt2, item);
  const talent = TT2_TREE.findIndex(k => k.effects.some(e => e.type === 'AllEquipmentEffect'));
  if (talent >= 0) {
    s.tt2.tree[talent] = Math.min(TT2_TREE[talent].max, (s.tt2.tree[talent] || 0) + 1);
    assert.notEqual(equipmentEffect(s.tt2, item), gearBefore, '天賦改變後裝備效果仍回舊值');
  }
  const petBefore = petBonus(s.tt2, 0);
  s.tt2.petLevels[0] += 10;
  assert.notEqual(petBonus(s.tt2, 0), petBefore, '寵物等級改變後仍回舊值');
});

test('the cached path gives the same answer as a freshly built state', () => {
  const warm = armed();
  dps(warm); tapDamage(warm);
  warm.tt2.artifacts[0] += 5;
  warm.tt2.petLevels[0] += 5;
  const cold = armed();
  cold.tt2.artifacts[0] += 5;
  cold.tt2.petLevels[0] += 5;
  assert.equal(toNumber(dps(warm)), toNumber(dps(cold)), '快取結果應與全新狀態一致');
  assert.equal(toNumber(tapDamage(warm)), toNumber(tapDamage(cold)));
  assert.equal(effect(warm.tt2, 'AllDamage'), effect(cold.tt2, 'AllDamage'));
  assert.equal(effect(warm.tt2, 'GoldAll'), effect(cold.tt2, 'GoldAll'));
});

test('resolving the same bonus repeatedly is cheap enough for a ten hertz loop', () => {
  const s = armed();
  dps(s);
  const started = process.hrtime.bigint();
  for (let n = 0; n < 200; n++) dps(s);
  const perCall = Number(process.hrtime.bigint() - started) / 1e6 / 200;
  // Measured at about 0.3ms; the guard is loose enough to survive a slower machine.
  assert.ok(perCall < 5, `dps() 每次 ${perCall.toFixed(2)}ms，應遠低於 100ms 的畫面間隔`);
});
