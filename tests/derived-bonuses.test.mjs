import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { fresh, hydrate, tapDamage, goldReward, manaMax, manaCapDamage, stateEffect,
         MANA_DEFAULTS } from '../lib/engine.ts';
import { TT2_SETS, bonusDefinitions } from '../lib/tt2-rules.ts';
import { PLAYER_LEVEL_CAP } from '../lib/tt2-limits.ts';
import { toNumber } from '../lib/big-number.ts';

const evidence = JSON.parse(readFileSync(new URL('derived-bonus-evidence.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));
const corrupted = TT2_SETS.findIndex(s => s.id === 'Corrupted');
const diamond = TT2_SETS.findIndex(s => s.id === 'Diamond');

function save(level, sets = []) {
  const s = hydrate(fresh(1000));
  s.level = level; s.best = 2000; s.stage = 2000; s.tt2.sets = sets;
  return s;
}

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
});

test('兩條的形狀不同：金幣那條有加 1，魔力上限那條沒有', () => {
  const gold = evidence.calls.gold.map(c => c.call);
  assert.deepEqual(gold, ['GetBonus', 'ModifyBonus']);
  assert.match(evidence.expressions.gold, /1 \+ 劍術大師等級/);
  assert.doesNotMatch(evidence.expressions.damage, /1 \+/);
  const mana = evidence.calls.manaCap.map(c => c.call);
  assert.ok(mana.includes('GetBonusIdentity'), '魔力上限那條要靠中性值比對才安全');
  assert.ok(mana.includes('RemoveBonus'));
});

test('劍術大師等級會加金幣，滿級是 13.5 倍', () => {
  for (const [level, expected] of [[100, 1.1], [1000, 2], [PLAYER_LEVEL_CAP, 13.5]]) {
    const plain = toNumber(goldReward(save(level), 'monster'));
    const ratio = toNumber(goldReward(save(level, [diamond]), 'monster')) / plain;
    assert.ok(Math.abs(ratio - expected) < 1e-9 * expected,
      `劍術大師 ${level} 級應該是 ×${expected}，實際 ×${ratio}`);
  }
});

test('魔力上限會加傷害，六個技能全解鎖時是 10.5 倍', () => {
  for (const [level, expected] of [[100, 1.75], [350, 10.5], [600, 10.5]]) {
    const plain = toNumber(tapDamage(save(level)));
    const ratio = toNumber(tapDamage(save(level, [corrupted]))) / plain;
    assert.ok(Math.abs(ratio - expected) < 1e-9 * expected,
      `劍術大師 ${level} 級應該是 ×${expected}，實際 ×${ratio}`);
    assert.equal(expected, manaMax(save(level)) * 0.05 || 1.75);
  }
});

test('沒有來源的人不受影響——中性值是 1，不是 0', () => {
  // 這一條是整段最容易寫錯的地方：DamagePerManaCap 是乘法型，沒有來源時讀到 1。
  // 若把 1 當成「有加成」，每個人的傷害都會乘上自己的整個魔力上限。
  assert.equal(bonusDefinitions.DamagePerManaCap.additive, false);
  for (const level of [50, 100, 350, 600]) {
    const s = save(level);
    assert.equal(stateEffect(s, 'DamagePerManaCap'), 1, '沒有來源時讀到的是中性值 1');
    assert.equal(manaCapDamage(s), 1, `劍術大師 ${level} 級、沒有來源時不該套用`);
  }
});

test('魔力上限還是 0 的時候不套用，這是刻意偏離原生', () => {
  // 原生此時會讓 AllDamage 乘以 0；原生的節奏走不到這裡，本專案可以，
  // 而傷害歸零之後金幣只能靠擊殺取得，等於救不回來。
  const early = save(50, [corrupted]);
  assert.equal(manaMax(early), 0, '劍術大師 100 級前還沒解鎖任何技能');
  assert.equal(manaCapDamage(early), 1);
  assert.equal(toNumber(tapDamage(early)), toNumber(tapDamage(save(50))));
  assert.match(evidence.consequence, /刻意偏離/);
  assert.ok(evidence.limits.some(l => l.includes('刻意偏離')));
});

test('夾擠上限照原生記著，只是本專案碰不到', () => {
  assert.equal(MANA_DEFAULTS.capBonusMax, 5000);
  assert.equal(evidence.manaCapLimit.serverVar, 'maximumManaCapBonusAmount');
  assert.equal(evidence.manaCapLimit.defaultValue, 5000);
  assert.equal(evidence.manaCapLimit.status, 'default');
  assert.ok(manaMax(save(PLAYER_LEVEL_CAP)) < MANA_DEFAULTS.capBonusMax, '本專案的魔力上限夾不到');
});

test('兩套套裝都做得出來，加成才不是擺著看的', () => {
  for (const index of [corrupted, diamond]) {
    assert.ok(['Mythic', 'Legendary', 'Rare'].includes(TT2_SETS[index].rarity),
      `${TT2_SETS[index].id} 要在 craftSet 收的稀有度裡`);
  }
});
