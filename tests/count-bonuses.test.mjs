import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { fresh, hydrate, tapDamage, helperWeaponDamage, maxStageDamage, stateEffect } from '../lib/engine.ts';
import { buildMultiplier, TT2_SETS, bonusDefinitions } from '../lib/tt2-rules.ts';
import { TT2_GEAR } from '../lib/tt2-data.ts';
import { toNumber } from '../lib/big-number.ts';

const evidence = JSON.parse(readFileSync(new URL('count-bonus-evidence.json', referenceRoot), 'utf8'));
const coverage = JSON.parse(readFileSync(new URL('../docs/bonus-coverage.json', import.meta.url), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));
const blacksmith = TT2_SETS.findIndex(s => s.id === 'Blacksmith');
const weaponMaster = TT2_SETS.findIndex(s => s.id === 'WeaponMaster');

function save({ sets = [], weapons = 0 } = {}) {
  const s = hydrate(fresh(1000));
  s.level = 600; s.best = 2000; s.stage = 2000;
  s.tt2.sets = sets;
  s.weapons = s.weapons.map(() => weapons);
  return s;
}

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
});

test('最高關卡也是次方，指數是關卡本身', () => {
  const nomad = TT2_SETS.findIndex(s => s.id === 'Nomad');
  assert.match(evidence.expressions.maxStage, /\^ 本季最高關卡/);
  const shape = evidence.calls.maxStage.map(c => c.call);
  assert.deepEqual(shape, ['GetBonus', 'ModifyBonus']);
  for (const best of [500, 2000, 10000]) {
    const plain = save(); plain.best = best;
    const withSet = save({ sets: [nomad] }); withSet.best = best;
    const per = stateEffect(withSet, 'DamagePerMaxStage');
    const ratio = toNumber(tapDamage(withSet)) / toNumber(tapDamage(plain));
    assert.ok(Math.abs(ratio - per ** best) < 1e-9 * per ** best,
      `第 ${best} 關應該是 ${per}^${best}`);
  }
  assert.equal(maxStageDamage(save()), 1, '沒有來源時不該有影響');
});

test('兩條的算術不同：套裝取次方，武器是乘法而且沒有加 1', () => {
  assert.match(evidence.expressions.equipmentSets, /\^ 集齊的套裝數/);
  assert.match(evidence.expressions.helperWeapons, /武器總等級 × DamagePerHelperWeapon/);
  assert.doesNotMatch(evidence.expressions.helperWeapons, /1 \+/);
});

test('集齊的套裝數走次方，沒有來源時 1 的任何次方都是 1', () => {
  // 固定其餘加成，否則湊數用的套裝自己的效果會蓋過要測的東西。
  const fixed = per => id => (id === 'DamagePerEquipmentSet' ? per : bonusDefinitions[id]?.additive ? 0 : 1);
  for (const count of [0, 1, 5, 10, 20]) {
    const s = hydrate(fresh(1000));
    s.tt2.sets = Array.from({ length: count }, (_, i) => i);
    assert.ok(Math.abs(buildMultiplier(s.tt2, 'tap', 0, false, fixed(1.19)) - 1.19 ** count) < 1e-9 * 1.19 ** count,
      `集齊 ${count} 套應該是 1.19^${count}`);
    assert.equal(buildMultiplier(s.tt2, 'tap', 0, false, fixed(1)), 1, '沒有來源時不該有影響');
  }
});

test('湊齊鐵匠套裝，傷害就是乘上那一個次方', () => {
  const plain = toNumber(tapDamage(save()));
  const ratio = toNumber(tapDamage(save({ sets: [blacksmith] }))) / plain;
  const per = stateEffect(save({ sets: [blacksmith] }), 'DamagePerEquipmentSet');
  assert.ok(Math.abs(ratio - per) < 1e-9 * per, `集齊 1 套應該是 ×${per}，實際 ×${ratio}`);
});

test('武器總等級走乘法，總等級 0 或沒有來源時都不套用', () => {
  assert.equal(bonusDefinitions.DamagePerHelperWeapon.additive, false);
  assert.equal(stateEffect(save(), 'DamagePerHelperWeapon'), 1, '沒有來源時讀到的是中性值 1');
  assert.equal(helperWeaponDamage(save({ weapons: 5 })), 1, '沒有來源就不套用');
  assert.equal(helperWeaponDamage(save({ sets: [weaponMaster], weapons: 0 })), 1, '總等級 0 就不套用');
});

test('有武器大師套裝時，倍率就是總等級乘上每級的值', () => {
  for (const weapons of [1, 3, 10]) {
    const s = save({ sets: [weaponMaster], weapons });
    const levels = s.weapons.reduce((a, b) => a + b, 0) + s.tt2.extraWeapons.reduce((a, b) => a + b, 0);
    const per = stateEffect(s, 'DamagePerHelperWeapon');
    assert.ok(Math.abs(helperWeaponDamage(s) - levels * per) < 1e-9 * levels * per,
      `總等級 ${levels} 應該是 ×${levels * per}`);
  }
});

test('總等級低的時候這套套裝會讓傷害變低，而且那是原生行為', () => {
  // 每級 0.1、總等級 5 → ×0.5。原生沒有加 1 也沒有夾下限，而總等級只會往上累積，
  // 玩家自己走得出來，所以照原生保留而不是補一個下限。
  const s = save({ sets: [weaponMaster] });
  s.weapons = s.weapons.map(() => 0);
  s.weapons[0] = 5;
  assert.ok(helperWeaponDamage(s) < 1, '總等級 5、每級 0.1 應該是 ×0.5');
  assert.match(evidence.consequence, /會讓傷害變低/);
  assert.ok(evidence.limits.some(l => l.includes('原生行為')));
});

test('次方那一項沒有來源，所以刻意不接', () => {
  assert.ok(!('DamagePerHelperWeaponMult' in bonusDefinitions));
  assert.match(evidence.consequence, /DamagePerHelperWeaponMult/);
});

test('那把「長槍」武器目前還沒有取得途徑', () => {
  const lance = TT2_GEAR.find(g => g.effect === 'DamagePerHelperWeapon');
  assert.equal(lance.id, 'Weapon_Lance');
  const set = TT2_SETS.find(s => s.id === lance.set);
  assert.ok(!['Mythic', 'Legendary', 'Rare'].includes(set.rarity),
    'craftSet 只接受 Mythic／Legendary／Rare，掉落池只收 rarity 1');
});

test('記下掃描會低估的實例：依稀有度選的加成是用暫存器傳的', () => {
  assert.ok(evidence.sweepUndercount.registerPassedReads.length > 0);
  for (const id of evidence.sweepUndercount.affectedBonuses) {
    const row = coverage.rows.find(r => r.id === id);
    if (!row || !row.sources) continue;
    assert.equal(row.verdict, 'dead-native-ignores-it',
      `${id} 目前被歸成「原生也沒用」，那正是這份證據要更正的誤解`);
  }
});
