import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { fresh, hydrate, tapDamage, buildDamage, stateEffect } from '../lib/engine.ts';
import { buildMultiplier, effect, spentPoints, bonusDefinitions, TT2_SETS, TT2_TREE } from '../lib/tt2-rules.ts';
import { TT2_GEAR } from '../lib/tt2-data.ts';
import { toNumber } from '../lib/big-number.ts';

const evidence = JSON.parse(readFileSync(new URL('skill-point-damage-evidence.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));
const jester = TT2_SETS.findIndex(s => s.id === 'Jester');

/** A save at the given stage with the matching number of collected skill points. */
function at(stage, { set = false } = {}) {
  const s = hydrate(fresh(1000));
  s.level = 600; s.best = stage; s.stage = stage;
  s.tt2.points = Math.max(0, Math.floor(stage / 50) - 1);
  s.tt2.earnedPoints = s.tt2.points;
  if (set) s.tt2.sets = [jester];
  return s;
}

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
});

test('原生把技能點算成 AllDamage 的乘數，兩項都寫回同一個加成', () => {
  const reads = evidence.calls.filter(c => c.call === 'BonusModel$$GetBonus').map(c => c.bonus);
  const writes = evidence.calls.filter(c => c.call === 'BonusModel$$ModifyBonus').map(c => c.bonus);
  assert.deepEqual(reads, [163, 164], '讀的是 DamagePerSkillPoint 與 DamagePerSkillPointMult');
  assert.deepEqual(writes, [37, 37], '兩項都寫回 AllDamage');
  assert.equal(evidence.methods['PlayerModel$$RefreshSkillPointBonuses'], '0x23dbbec');
});

test('點數取的是累計收到的，不是還沒花掉的', () => {
  assert.equal(evidence.pointSource.field, 'skillPointsReceivedServer');
  assert.equal(evidence.pointSource.offset, '0x300');

  // 買下天賦之後，那個天賦自己的加成會蓋過點數這一項的差異，所以這裡把其餘加成固定成中性值，
  // 只讓 DamagePerSkillPoint 有值——剩下唯一的變數就是「點數怎麼算」。
  const fixed = id => (id === 'DamagePerSkillPoint' ? 0.1 : bonusDefinitions[id]?.additive ? 0 : 1);
  const unspent = at(2000);
  const talent = TT2_TREE.findIndex(k => k.cost[0] > 0 && k.cost[0] < unspent.tt2.points);
  const cost = TT2_TREE[talent].cost[0];
  const invested = at(2000);
  invested.tt2.points -= cost;
  invested.tt2.tree[talent] = 1;

  assert.equal(spentPoints(invested.tt2), cost, '這幾點確實花掉了');
  assert.equal(invested.tt2.points + spentPoints(invested.tt2), unspent.tt2.points,
    '兩邊累計收到的點數要一樣，才比得出來');
  assert.equal(buildMultiplier(invested.tt2, 'tap', 0, false, fixed),
    buildMultiplier(unspent.tt2, 'tap', 0, false, fixed),
    '把點數投進天賦不該讓這一項縮水——原生算的是累計收到的點數');
});

test('沒有任何來源的存檔完全不受影響', () => {
  const s = at(2000);
  assert.equal(stateEffect(s, 'DamagePerSkillPoint'), 0);
  const t = s.tt2;
  const plain = buildMultiplier(t, 'tap', 0, false);
  const inflated = buildMultiplier(t, 'tap', 0, false,
    id => (id === 'DamagePerSkillPoint' ? 0 : effect(t, id)));
  assert.equal(inflated, plain);
});

test('湊齊小丑女王套裝之後，每一點技能點就是 +10%', () => {
  for (const stage of [500, 1000, 2000]) {
    const plain = toNumber(tapDamage(at(stage)));
    const withSet = at(stage, { set: true });
    const points = withSet.tt2.points;
    const perPoint = stateEffect(withSet, 'DamagePerSkillPoint');
    assert.ok(Math.abs(perPoint - 0.1) < 1e-12, `每點應該是 +10%，實際 ${perPoint}`);
    const ratio = toNumber(tapDamage(withSet)) / plain;
    assert.ok(Math.abs(ratio - (1 + 0.1 * points)) < 1e-9 * ratio,
      `第 ${stage} 關 ${points} 點應該是 ×${1 + 0.1 * points}，實際 ×${ratio}`);
  }
});

test('每一種傷害都吃這個加成，和原生寫進 AllDamage 一致', () => {
  const plain = at(2000), withSet = at(2000, { set: true });
  for (const build of ['tap', 'pet', 'clone', 'heavenly']) {
    const ratio = toNumber(buildDamage(withSet, build)) / toNumber(buildDamage(plain, build));
    assert.ok(ratio > 1, `${build} 也應該吃到技能點加成`);
  }
});

test('次方項沒有來源，所以刻意不接', () => {
  assert.match(evidence.consequence, /DamagePerSkillPointMult/);
  const sources = [...TT2_SETS, ...TT2_TREE, ...TT2_GEAR];
  assert.ok(!JSON.stringify(sources).includes('DamagePerSkillPointMult'),
    '一旦有來源開始給它，就要照原生把次方項補上');
});

test('那把「復仇者」武器目前還沒有取得途徑', () => {
  const weapon = TT2_GEAR.find(g => g.effect === 'DamagePerSkillPoint');
  assert.equal(weapon.id, 'Weapon_Retaliator');
  assert.notEqual(weapon.rarity, 1, '掉落池只收 rarity 1');
  const set = TT2_SETS.find(s => s.id === weapon.set);
  assert.ok(!['Mythic', 'Legendary', 'Rare'].includes(set.rarity),
    'craftSet 只接受 Mythic／Legendary／Rare；這件變成做得出來時，它的值會直接生效');
});
