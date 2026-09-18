import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import {
  fresh, advance, apply, monsterCount, isBoss,
  chestChance, megaBombChance, megaBombMaxStacks, megaBombStackLength,
  BONUS_DEFAULTS, MEGA_BOMB,
} from '../lib/engine.ts';
import { effect } from '../lib/tt2-rules.ts';

const evidence = JSON.parse(readFileSync(new URL('special-titan-evidence.json', referenceRoot), 'utf8'));
const defaults = JSON.parse(readFileSync(new URL('bonus-defaults-evidence.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));

// The sources that feed this system, by the bonus each one declares.
const GAUNTLET = 88;      // 無限手套: MegaBombSpawnChance
const LOVE_POTION = 60;   // 愛情靈藥: SpecialTitanSpawnChance
const SET_SPAWN = 19;     // SpecialTitanSpawnChance
const SET_DURATION = 51;  // SpecialTitanStackDurationMult
const SET_STACKS = 83;    // MegaBombMaxStacks + MegaBombSpawnChance

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
  assert.equal(evidence.binarySha256, defaults.binarySha256, '兩份證據要出自同一個 binary');
});

test('八段算式與佇列狀態機都在證據裡', () => {
  assert.equal(evidence.formulas.megaBombChance,
    'MegaBombSpawnChance × SpecialTitanSpawnChance × AllProbabilityBoost');
  assert.equal(evidence.formulas.chestersonChance,
    'ChestChance × SpecialTitanSpawnChance × AllProbabilityBoost');
  assert.equal(evidence.formulas.stackLength,
    'floor(megaBombMonsterMaxStageEffectAmount × SpecialTitanStackDurationMult)');
  assert.equal(evidence.formulas.titanCount,
    'floor(該關隻數 × pow(megaBombMonsterTitanRemovalPercent, 堆疊層數))');

  // Each trace must name the bonuses it claims, or the shape check proved nothing.
  const named = kind => evidence.traces[kind].filter(e => e[0] === 'GetBonus').map(e => e[1]);
  assert.deepEqual(named('megaBombChance'),
    ['AllProbabilityBoost', 'SpecialTitanSpawnChance', 'MegaBombSpawnChance']);
  assert.deepEqual(named('chestersonChance'),
    ['AllProbabilityBoost', 'SpecialTitanSpawnChance', 'ChestChance']);
  assert.deepEqual(named('megaBombStackCap'), ['MegaBombMaxStacks']);
  assert.deepEqual(named('megaBombStackLength'), ['SpecialTitanStackDurationMult']);

  // The cap is enforced on the spawn side: the defeat side compares against the stack's own
  // length, and the evidence records that as three calls through one vtable slot.
  const slots = evidence.traces.push.filter(e => e[0] === 'vcall').map(e => e[1]);
  assert.equal(slots.length, 3);
  assert.equal(new Set(slots).size, 1, '擊殺端三次虛擬呼叫應該走同一個槽');
  const gate = evidence.traces.canSpawn.filter(e => e[0] === 'vcall').map(e => e[1]);
  assert.notDeepEqual(gate, [slots[0]], '生成端比的是另一個槽（MaxStackCount）');
});

test('引擎用的基礎值就是證據上的值', () => {
  assert.equal(BONUS_DEFAULTS.megaBombChance, Math.fround(evidence.bases.MegaBombSpawnChance.value));
  assert.equal(BONUS_DEFAULTS.megaBombMaxStacks, evidence.bases.MegaBombMaxStacks.value);
  assert.equal(MEGA_BOMB.stageLength, evidence.statics.megaBombMonsterMaxStageEffectAmount.value);
  assert.equal(MEGA_BOMB.titanRemoval,
    Math.fround(evidence.statics.megaBombMonsterTitanRemovalPercent.value));
  assert.equal(evidence.bases.MegaBombSpawnChance.field, 'megaBombMonsterSpawnChance');
  assert.equal(evidence.bases.MegaBombMaxStacks.field, 'megaBombBaseStacks');
});

test('乾淨存檔：0.1% 機率，最多一疊，一疊十關', () => {
  const s = fresh(1000);
  assert.equal(megaBombChance(s), Math.fround(0.001));
  assert.equal(megaBombMaxStacks(s), 1);
  assert.equal(megaBombStackLength(s), 10);
  // The two multiplicative factors are neutral without a source, so the roll is just the base.
  assert.equal(effect(s.tt2, 'SpecialTitanSpawnChance'), 1);
  assert.equal(effect(s.tt2, 'SpecialTitanStackDurationMult'), 1);
});

test('寶箱機率補上了 SpecialTitanSpawnChance，沒有來源時數值不變', () => {
  const clean = fresh(1000);
  assert.equal(chestChance(clean), Math.fround(0.01), '沒有來源時與上一版相同');

  // With a source the factor has to actually move it - that is the fix this version makes.
  const boosted = fresh(1000);
  boosted.tt2.tree[LOVE_POTION] = 9;
  const factor = effect(boosted.tt2, 'SpecialTitanSpawnChance');
  assert.ok(factor > 1, '愛情靈藥要給大於 1 的倍率');
  assert.equal(chestChance(boosted), Math.fround(0.01) * factor);
  assert.equal(megaBombChance(boosted), Math.fround(0.001) * factor, '同一個因子也放大炸彈泰坦');
});

test('四個加成各自推動它該推動的那一項', () => {
  const base = fresh(1000);
  const chanceBefore = megaBombChance(base);
  const capBefore = megaBombMaxStacks(base);
  const lengthBefore = megaBombStackLength(base);

  const gauntlet = fresh(1000);
  gauntlet.tt2.artifacts[GAUNTLET] = 40;
  assert.ok(megaBombChance(gauntlet) > chanceBefore, '無限手套要拉高生成機率');
  assert.equal(megaBombMaxStacks(gauntlet), capBefore);
  assert.equal(megaBombStackLength(gauntlet), lengthBefore);

  const longer = fresh(1000);
  longer.tt2.sets = [SET_DURATION];
  assert.ok(megaBombStackLength(longer) > lengthBefore, '延長套裝要讓一疊撐更多關');
  assert.equal(megaBombChance(longer), chanceBefore);
  assert.equal(megaBombMaxStacks(longer), capBefore);

  const deeper = fresh(1000);
  deeper.tt2.sets = [SET_STACKS];
  assert.equal(megaBombMaxStacks(deeper), capBefore + 1, '堆疊套裝要讓上限多一層');
  assert.ok(megaBombChance(deeper) > chanceBefore, '同一套也拉高生成機率');

  const spawn = fresh(1000);
  spawn.tt2.sets = [SET_SPAWN];
  assert.ok(megaBombChance(spawn) > chanceBefore, '特殊泰坦套裝要拉高生成機率');
  assert.equal(megaBombStackLength(spawn), lengthBefore, '它不該動到持續關數');
});

test('每一疊讓該關隻數乘 0.9，最後才夾到一隻', () => {
  const s = fresh(1000);
  s.stage = 1000;
  const plain = monsterCount(s);
  assert.ok(plain > 1);

  for (const stacks of [1, 2, 3]) {
    s.tt2.bombStacks = Array(stacks).fill(10);
    assert.equal(monsterCount(s), Math.max(1, Math.floor(plain * MEGA_BOMB.titanRemoval ** stacks)),
      `${stacks} 疊`);
  }

  // Enough stacks would take it below one; the native floors it at one, and so must this.
  s.tt2.bombStacks = Array(60).fill(10);
  assert.equal(monsterCount(s), 1, '再怎麼減也至少留一隻');
  s.tt2.bombStacks = [];
  assert.equal(monsterCount(s), plain, '沒有堆疊就跟以前一樣');
});

test('清掉一關讓每一疊少一關，歸零的移除', () => {
  const s = fresh(1000);
  s.tt2.bombStacks = [3, 1];
  s.heroes = s.heroes.map(() => 400);

  // Clear one stage the ordinary way, by killing through it.
  const from = s.stage;
  let now = s.last;
  for (let n = 0; n < 4000 && s.stage === from; n++) {
    now += 120;
    apply(s, { type: 'tap', at: now });
  }
  assert.ok(s.stage > from, '這一關應該被清掉了');
  assert.ok(!s.tt2.bombStacks.includes(1), '剩一關的那疊要在過關後消失');
  assert.ok(s.tt2.bombStacks.every(n => n >= 1), '留下來的都還有關數');
});

test('實際遊玩時堆疊不會超過上限，而且真的會堆起來', () => {
  const s = fresh(1000);
  // Enough of the roll to make bombs common, and two stacks' worth of room.
  s.tt2.artifacts[GAUNTLET] = 40;
  s.tt2.tree[LOVE_POTION] = 9;
  s.tt2.sets = [SET_STACKS, SET_SPAWN];
  s.heroes = s.heroes.map(() => 400);
  const cap = megaBombMaxStacks(s);
  assert.ok(cap >= 2, '這組來源應該給至少兩層');

  let now = s.last, seen = 0;
  for (let n = 0; n < 20000; n++) {
    now += 120;
    apply(s, { type: 'tap', at: now });
    assert.ok(s.tt2.bombStacks.length <= cap, `堆疊 ${s.tt2.bombStacks.length} 超過上限 ${cap}`);
    assert.ok(s.tt2.bombStacks.every(v => Number.isInteger(v) && v >= 1), '每疊都該是正整數關數');
    seen = Math.max(seen, s.tt2.bombStacks.length);
  }
  assert.ok(seen > 0, '這組來源下應該打得到炸彈泰坦');
  assert.ok(s.tt2.bombKills > 0, '擊殺數要跟著記');
});

test('沒有投資的存檔，炸彈泰坦很罕見', () => {
  const s = fresh(1000);
  s.heroes = s.heroes.map(() => 400);
  let now = s.last, kills = 0;
  for (let n = 0; n < 6000; n++) {
    now += 120;
    apply(s, { type: 'tap', at: now });
  }
  kills = s.tt2.bombKills;
  // The base roll is 0.1% per titan killed; this only has to show it is rare.
  assert.ok(kills / Math.max(1, s.totalKills) < 0.02,
    `未投資時炸彈泰坦不該常見，實測 ${kills}/${s.totalKills}`);
});

test('2.17.0 之前的存檔沒有這兩個欄位，補成空的堆疊', () => {
  const s = fresh(1000);
  delete s.tt2.bombStacks;
  delete s.tt2.bombKills;
  advance(s, s.last + 1);
  assert.deepEqual(s.tt2.bombStacks, []);
  assert.equal(s.tt2.bombKills, 0);

  // Junk in the field must not survive into the multiplier: a zero or a negative would be a stack
  // that never expires, and a fractional one would make the titan count irreproducible.
  const broken = fresh(1000);
  broken.tt2.bombStacks = [0, -3, 2.7, 5, Number.NaN];
  advance(broken, broken.last + 1);
  assert.deepEqual(broken.tt2.bombStacks, [2, 5]);
});

test('頭目不會是特殊泰坦', () => {
  const s = fresh(1000);
  s.kills = monsterCount(s);
  assert.ok(isBoss(s));
  const source = readFileSync(new URL('../lib/engine.ts', import.meta.url), 'utf8');
  // Both rolls are gated on the same !boss check, in one place.
  assert.match(source, /const chest=!boss&&tt2Random/);
  assert.match(source, /const bomb=!boss&&!chest&&tt2Random/);
});
