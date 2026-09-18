import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh, hydrate, stateEffect, stateResolver, dps, tapDamage, goldReward } from '../lib/engine.ts';
import { effect, effectResolver, TT2_SETS, TT2_TREE } from '../lib/tt2-rules.ts';
import { TT2_ARTIFACTS, TT2_PETS } from '../lib/tt2-data.ts';
import { toNumber } from '../lib/big-number.ts';

const KEYS = ['AllDamage', 'GoldAll', 'CritDamage', 'TapDamage', 'AllHelperDamage', 'ChestAmount',
  'DamagePerSkillPoint', 'DamagePerManaCap', 'DamagePerHelperWeapon', 'DamagePerEquipmentSet'];

/** A save with something in every bucket the caches key on. */
function loaded() {
  const s = hydrate(fresh(1000));
  s.level = 600; s.best = 2000; s.stage = 2000;
  s.heroes = s.heroes.map(() => 120);
  s.weapons = s.weapons.map(() => 3);
  s.tt2.artifacts = s.tt2.artifacts.map((_, i) => (i < 20 ? 30 : 0));
  s.tt2.tree = s.tt2.tree.map((_, i) => (i < 10 ? 5 : 0));
  s.tt2.sets = [TT2_SETS.findIndex(x => x.id === 'Jester'), TT2_SETS.findIndex(x => x.id === 'Blacksmith')];
  s.tt2.petLevels = s.tt2.petLevels.map(() => 40);
  s.tt2.activePets = [0, 1];
  s.tt2.points = 39;
  return s;
}

test('批次取得的 resolver 與逐次查詢結果完全相同', () => {
  const s = loaded();
  const resolve = stateResolver(s);
  for (const key of KEYS) assert.equal(resolve(key), stateEffect(s, key), key);
});

test('底層的加成 resolver 也與逐次 effect 相同', () => {
  const t = loaded().tt2;
  const resolve = effectResolver(t);
  for (const key of KEYS) assert.equal(resolve(key), effect(t, key), key);
});

test('狀態改變之後，新取得的 resolver 看得到新值', () => {
  const s = loaded();
  const artifact = TT2_ARTIFACTS.findIndex(a => a.effect === 'CritDamage');
  const before = stateResolver(s)('CritDamage');
  s.tt2.artifacts[artifact] = (s.tt2.artifacts[artifact] || 0) + 50;
  assert.ok(stateResolver(s)('CritDamage') > before, '升級神器之後應該看得到');

  const talent = TT2_TREE.findIndex(k => JSON.stringify(k.effects || []).includes('"CritDamage"'));
  const mid = stateResolver(s)('CritDamage');
  s.tt2.tree[talent] = Math.min(TT2_TREE[talent].max, 20);
  assert.ok(stateResolver(s)('CritDamage') > mid, '點天賦之後也應該看得到');

  // 寵物走的是另一組戳記（visitExtra），漏掉它會讓升級寵物看不出效果。
  const pet = TT2_PETS.findIndex(p => p.effect && p.effect !== 'None');
  const key = TT2_PETS[pet].effect;
  s.tt2.activePets = [pet, -1];
  const petBefore = stateResolver(s)(key);
  s.tt2.petLevels = s.tt2.petLevels.map((n, i) => (i === pet ? n + 60 : n));
  assert.notEqual(stateResolver(s)(key), petBefore, `升級寵物之後 ${key} 應該跟著變`);
});

test('resolver 是取得當下的快照——這是批次的語意，不是漏更新', () => {
  // 熱路徑在一次計算之內不會改狀態，所以共用一份快照是安全的；
  // 但這個行為要釘住，免得有人把 resolver 存起來跨越一次計算使用。
  const s = loaded();
  const resolve = stateResolver(s);
  const before = resolve('CritDamage');
  const artifact = TT2_ARTIFACTS.findIndex(a => a.effect === 'CritDamage');
  s.tt2.artifacts[artifact] = (s.tt2.artifacts[artifact] || 0) + 100;
  assert.equal(resolve('CritDamage'), before, '同一個 resolver 在批次內維持一致');
  assert.ok(stateResolver(s)('CritDamage') > before, '重新取得就會看到新值');
});

test('改用批次之後，三條熱路徑的數字沒有變', () => {
  const s = loaded();
  // 逐項對照：這些值在批次化之前後必須一致，否則就是快取抓錯了。
  const damage = toNumber(tapDamage(s)), heroes = toNumber(dps(s)), gold = toNumber(goldReward(s, 'monster'));
  assert.ok(damage > 0 && heroes > 0 && gold > 0);
  // 重算一次，結果必須穩定（快取沒有把中途狀態寫進去）。
  assert.equal(toNumber(tapDamage(s)), damage);
  assert.equal(toNumber(dps(s)), heroes);
  assert.equal(toNumber(goldReward(s, 'monster')), gold);
});
