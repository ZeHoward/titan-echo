import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { fresh, apply, titanSkip, stageSkip, monsterCount, isBoss } from '../lib/engine.ts';
import { TT2_TREE } from '../lib/tt2-rules.ts';
import { fromNumber, toNumber } from '../lib/big-number.ts';

const evidence = JSON.parse(readFileSync(new URL('skip-evidence.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));
const talent = id => TT2_TREE.findIndex(k => k.id === id);

/** 一個已經在打小怪、身上有錢也殺得動的狀態。 */
const ready = (stage = 30) => {
  const s = fresh(1000);
  s.level = 400;
  s.best = stage;
  s.stage = stage;
  // 金幣從 0 起算：1e60 加上一隻小怪的金幣在浮點上不會變，看不出有沒有給。
  s.tt2.gearMilestone = stage;      // 不讓既有的掉落干擾計數
  s.tt2.earnedPoints = Math.max(0, Math.floor(stage / 50) - 1);
  s.tt2.points = 0;
  return s;
};

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
});

test('原生有六個跳泰坦來源與七個跳關來源，本專案只實作得了其中三個', () => {
  assert.equal(evidence.rules.titanSkip.sources.length, 6);
  assert.equal(evidence.rules.stageSkip.sources.length, 7);
  assert.deepEqual(evidence.implementableHere,
    ['ActiveSkillHeavenlyStrike', 'Pet', 'ActiveSkillShadowClone'].sort());
  // 沒實作的流派不可以被折算到別人身上：它們在證據裡就標著 false。
  const pending = evidence.rules.titanSkip.sources.filter(r => !r.implementedHere).map(r => r.damageType);
  assert.deepEqual(pending.sort(), ['ClanShip', 'Dagger', 'GoldGunRegular']);
});

test('身上沒有任何跳過天賦時，兩個算式都是 0', () => {
  const s = ready();
  for (const source of ['heavenly', 'pet', 'clone']) {
    assert.equal(titanSkip(s, source), 0, source);
    assert.equal(stageSkip(s, source), 0, source);
  }
});

test('跳過是逐來源的：買影分身的天賦不會讓天堂聖擊跟著跳', () => {
  const s = ready();
  s.tt2.tree[talent('CloneSkillBoost')] = 1;
  assert.equal(titanSkip(s, 'clone'), 5);
  assert.equal(stageSkip(s, 'clone'), 5);
  assert.equal(titanSkip(s, 'heavenly'), 0);
  assert.equal(titanSkip(s, 'pet'), 0);
  const t = ready();
  t.tt2.tree[talent('BurstSkillBoost')] = 1;
  assert.equal(titanSkip(t, 'heavenly'), 3);
  assert.equal(titanSkip(t, 'clone'), 0);
  assert.equal(titanSkip(t, 'pet'), 0, '寵物讀到了天堂聖擊的加成');
});

test('天堂聖擊擊殺會跳掉該來源的泰坦數，而且跳掉的照樣給金幣', () => {
  const s = ready();
  s.tt2.tree[talent('BurstSkillBoost')] = 1;   // 跳 3 隻
  s.skillLevels[5] = 1;
  s.tt2.mana = 500;
  const kills = s.totalKills;
  s.hp = fromNumber(1);                        // 這一擊必定擊殺
  apply(s, { type: 'skill', index: 5, at: s.last + 100 });
  assert.equal(s.kills, 4, '擊殺 1 隻＋跳過 3 隻');
  assert.equal(s.totalKills - kills, 4);
  assert.ok(toNumber(s.gold) > 0, '跳過的泰坦沒有給金幣');
});

test('跳泰坦夾在本關剩餘隻數內，不會直接跨進頭目', () => {
  const s = ready();
  s.tt2.tree[talent('BurstSkillBoost')] = 10;  // 跳 30 隻，遠超過一關的隻數
  s.skillLevels[5] = 1;
  s.tt2.mana = 500;
  const total = monsterCount(s);
  s.hp = fromNumber(1);
  apply(s, { type: 'skill', index: 5, at: s.last + 100 });
  assert.ok(s.kills <= total - 1, `殺到 ${s.kills} / ${total}，超出本關`);
  assert.equal(isBoss(s), s.kills >= total - 1 ? isBoss(s) : false);
  assert.equal(s.stage, 30, '跳泰坦不該推關');
});

test('跳關會推進關卡、給頭目金幣，技能點補上且不重複', () => {
  // BurstSkillBoost 只給跳泰坦；跳關在它的後續天賦 BurstSkillMana 上，等級 1 是 7 關。
  const s = ready(96);
  s.tt2.tree[talent('BurstSkillMana')] = 1;
  assert.equal(stageSkip(s, 'heavenly'), 7);
  assert.equal(stageSkip(s, 'pet'), 0, '跳關同樣是逐來源的');
  s.skillLevels[5] = 1;
  s.tt2.mana = 500;

  s.hp = fromNumber(1);
  apply(s, { type: 'skill', index: 5, at: s.last + 100 });
  assert.equal(s.stage, 103, '應該跳 7 關');
  assert.equal(s.best, 103);
  assert.ok(toNumber(s.gold) > 0, '跳過的關卡沒有給頭目金幣');
  // 第 96→103 關跨過 100，技能點要補上一點，而且只補一次。
  assert.equal(s.tt2.points, 1);
  assert.equal(s.tt2.earnedPoints, 1);
});
test('跳關跨過掉落關卡時，裝備掉落不漏領也不重複', () => {
  const s = ready(34);
  s.tt2.gearMilestone = 0;                     // 這一趟還沒掉過
  s.tt2.tree[talent('BurstSkillMana')] = 1;    // 跳 7 關，34 → 41，跨過 36
  s.skillLevels[5] = 1;
  s.tt2.mana = 500;
  s.hp = fromNumber(1);
  apply(s, { type: 'skill', index: 5, at: s.last + 100 });
  assert.equal(s.stage, 41);
  assert.equal(s.tt2.gearMilestone, 36, '跨過第 36 關卻沒有掉落');
  assert.equal(s.tt2.equipmentCollected, 1, '掉落次數不對');
  assert.equal(s.tt2.inventory.length, 1);
});

test('點擊與英雄每秒傷害沒有跳過能力，行為和改動前一樣', () => {
  const s = ready();
  s.tt2.tree[talent('BurstSkillMana')] = 9;    // 就算天賦滿了
  s.hp = fromNumber(1);
  apply(s, { type: 'tap', index: 0, at: s.last + 100 });
  assert.equal(s.kills, 1, '點擊不該跳泰坦');
  assert.equal(s.stage, 30, '點擊不該跳關');
});

test('不帶跳過天賦的一般推進沒有被這次改動影響', () => {
  const s = fresh(1000);
  s.level = 100;
  const normals = monsterCount(s);
  for (let i = 0; i < normals; i++) apply(s, { type: 'tap', index: 0, at: 1100 + i * 100 });
  assert.equal(s.stage, 1);
  assert.equal(s.kills, normals);
  assert.equal(isBoss(s), true);
  apply(s, { type: 'tap', index: 0, at: s.last + 100 });
  assert.equal(s.stage, 2);
  assert.equal(s.kills, 0);
  assert.equal(isBoss(s), false);
});
