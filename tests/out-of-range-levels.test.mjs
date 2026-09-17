import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh, hydrate, manaMax, skillPower, skillMana, skillCost, buildDamage, dps, tapDamage,
  SKILL_DATA, skillStep, skillDuration } from '../lib/engine.ts';
import { effect, baseEffect, TT2_TREE, TT2_ARTIFACTS } from '../lib/tt2-rules.ts';
import { toNumber } from '../lib/big-number.ts';

// A talent's value list stops at that talent's own max, and a skill's tables stop at its max level.
// A save holding a higher level used to read `undefined` out of the array, and `total + undefined`
// is NaN — which then spread into every bonus, every damage figure and the mana cap. The live page
// showed "魔力 1e+240 / 1e+240" because the NaN was later clamped to the engine ceiling.

/** A save with every talent and skill pushed past its legal maximum. */
const overflowed = () => {
  const s = hydrate(fresh(1000));
  s.level = 802;
  s.tt2.tree = s.tt2.tree.map(() => 45);
  s.skillLevels = s.skillLevels.map(() => 99);
  return s;
};

test('超出上限的天賦等級不會讓加成變成 NaN', () => {
  const s = overflowed();
  // The talent that exposed it: MPCapacityBoost stops at 15 but the save says 45.
  const talent = TT2_TREE.findIndex(k => k.id === 'MPCapacityBoost');
  assert.ok(talent >= 0);
  assert.ok(TT2_TREE[talent].max < 45, '這個天賦的上限應低於測試用的等級');
  assert.ok(Number.isFinite(baseEffect(s.tt2, 'ManaPoolCap')), 'ManaPoolCap 仍是 NaN');
  assert.ok(Number.isFinite(effect(s.tt2, 'ManaPoolCap')));
  // Reading past the end must give the last legal row, not undefined.
  const values = TT2_TREE[talent].effects.find(e => e.type === 'ManaPoolCap').values;
  assert.equal(values[45], undefined, '前提：陣列真的沒有第 45 格');
  assert.ok(Number.isFinite(values[TT2_TREE[talent].max]));
});

test('超出上限的技能等級不會讓傷害與魔力變成 NaN', () => {
  const s = overflowed();
  assert.ok(Number.isFinite(skillPower(s, 0)), 'skillPower 仍是 NaN');
  assert.ok(Number.isFinite(skillMana(s, 0)), 'skillMana 仍是 NaN');
  assert.ok(Number.isFinite(skillCost(s, 0)), 'skillCost 仍是 NaN');
  assert.ok(Number.isFinite(toNumber(buildDamage(s, 'clone'))), 'clone 傷害仍是 NaN');
  assert.ok(Number.isFinite(toNumber(buildDamage(s, 'heavenly'))), 'heavenly 傷害仍是 NaN');
  // The clamp itself: one past the end reads the last row, far past the end reads the same row.
  assert.equal(skillStep(0, SKILL_DATA[0].amount.length + 1), SKILL_DATA[0].amount.length - 1);
  assert.equal(skillStep(0, 99), SKILL_DATA[0].amount.length - 1);
  assert.equal(skillStep(0, 0), 0);
  assert.equal(skillStep(0, 1), 0);
});

test('那張畫面上的數字回到有限值', () => {
  const s = overflowed();
  const cap = manaMax(s);
  assert.ok(Number.isFinite(cap), '魔力上限仍是非有限值');
  assert.ok(cap < 1e240, `魔力上限被夾到引擎天花板：${cap}`);
  assert.ok(Number.isFinite(toNumber(dps(s))));
  assert.ok(Number.isFinite(toNumber(tapDamage(s))));
});

test('神器等級也夾回購買路徑能達到的上限，技能鍵不會顯示 1e+240 秒', () => {
  const s = hydrate(fresh(1000));
  s.level = 802;
  // A level no amount of buying could reach drives the duration bonuses into the engine ceiling.
  s.tt2.artifacts = s.tt2.artifacts.map(() => 1e6);
  const loaded = hydrate(JSON.parse(JSON.stringify(s)));
  loaded.tt2.artifacts.forEach((level, i) => {
    const max = TT2_ARTIFACTS[i].max || 1e6;
    assert.ok(level <= max, `神器 ${i} 仍超界：${level} > ${max}`);
  });
  for (let i = 0; i < 6; i += 1) {
    assert.ok(Number.isFinite(skillDuration(loaded, i)), `技能 ${i} 的持續時間不是有限值`);
    assert.ok(skillDuration(loaded, i) < 1e240, `技能 ${i} 的持續時間到了引擎天花板`);
  }
});

test('壞掉的技能計時器不會讓技能永遠處於施放中', () => {
  const broken = JSON.parse(JSON.stringify(fresh(1000)));
  broken.active[0] = 1e243;
  broken.cooldowns[0] = 1e243;
  broken.active[1] = Number.NaN;
  const loaded = hydrate(broken);
  // Treated as already over, not clamped to a day: clamping would hand out a free day of the skill.
  assert.equal(loaded.active[0], 0, '壞掉的施放時間戳應視為已結束');
  assert.equal(loaded.cooldowns[0], 0);
  assert.equal(loaded.active[1], 0, '非數字的時間戳應視為沒有施放');
  // A legitimate timer is left exactly as it was.
  const running = JSON.parse(JSON.stringify(fresh(1000)));
  running.active[2] = running.last + 30_000;
  assert.equal(hydrate(running).active[2], running.last + 30_000);
});

test('讀取存檔時把超界的等級夾回合法範圍，壞掉的存檔不會一直壞下去', () => {
  const broken = JSON.parse(JSON.stringify(overflowed()));
  const loaded = hydrate(broken);
  loaded.tt2.tree.forEach((level, i) => assert.ok(level <= TT2_TREE[i].max, `天賦 ${i} 仍超界`));
  loaded.skillLevels.forEach((level, i) => assert.ok(level <= SKILL_DATA[i].max, `技能 ${i} 仍超界`));
  // Negative and non-numeric levels are brought back too, rather than indexing with them.
  const odd = JSON.parse(JSON.stringify(fresh(1000)));
  odd.tt2.tree[0] = -5;
  odd.skillLevels[0] = Number.NaN;
  const repaired = hydrate(odd);
  assert.equal(repaired.tt2.tree[0], 0);
  assert.equal(repaired.skillLevels[0], 0);
  assert.ok(Number.isFinite(manaMax(repaired)));
});
