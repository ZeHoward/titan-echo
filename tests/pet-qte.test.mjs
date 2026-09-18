import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import {
  fresh, advance, apply, qteReady, petBurstTaps, petBurstDamage, petAttackDamage,
  titanSkip, stageSkip, FAIRY,
} from '../lib/engine.ts';
import { TT2_QTE, QTE_TYPE, TT2_TREE, effect, qteUnlocked } from '../lib/tt2-rules.ts';
import { toNumber } from '../lib/big-number.ts';

const evidence = JSON.parse(readFileSync(new URL('pet-qte-evidence.json', referenceRoot), 'utf8'));
const coverage = JSON.parse(readFileSync(new URL('../docs/bonus-coverage.json', import.meta.url), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));
const rows = Object.fromEntries(coverage.rows.map(r => [r.id, r]));

const BURST = TT2_TREE.findIndex(k => k.id === 'PetQTE');       // 天賦「雷霆爆發」
const PET = 0;                                                  // 第一隻傷害寵物

/** A save with a damage pet out and the Lightning Burst talent learned. */
const armed = () => {
  const s = fresh(1000);
  s.best = 50;
  s.stage = 50;
  s.tt2.petLevels[PET] = 20;
  s.tt2.activePets[0] = PET;
  s.tt2.tree[BURST] = TT2_TREE[BURST].max;
  return s;
};
const waitForBurst = s => {
  const limit = s.last + TT2_QTE[QTE_TYPE.PetAttack].cooldown * 3000;
  while (!qteReady(s.tt2, QTE_TYPE.PetAttack) && s.last < limit) advance(s, s.last + 5000);
  return s;
};

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
});

test('大攻擊就是平常那一擊乘上一個加成，沒有別的因子', () => {
  assert.equal(evidence.formulas.burstDamage,
    'GetNormalAttack(true) × Bonus(PetAttackQTEDamage)');
  const calls = evidence.traces.bigAttack.filter(e => e[0] === 'call' || e[0] === 'GetBonus');
  assert.deepEqual(calls.map(e => [e[0], e[1]]),
    [['call', 'GetNormalAttack'], ['GetBonus', 'PetAttackQTEDamage'], ['call', 'op_Multiply']],
    '多一個加成就是多一個乘數，序列要整組比對');

  const s = armed();
  const plain = toNumber(petAttackDamage(s));
  const burst = toNumber(petBurstDamage(s));
  const bonus = effect(s.tt2, 'PetAttackQTEDamage');
  assert.ok(bonus > 1, '滿級的雷霆爆發應該給傷害加成');
  // 滿級是 10^46 等級的倍率，只能比相對誤差。
  assert.ok(Math.abs(burst / plain / bonus - 1) < 1e-12, '大攻擊就是平常那一擊乘上該加成');
});

test('連打次數從 30 起算，扣掉加成，最少一下', () => {
  assert.equal(evidence.statics.mashQTENumTaps.value, 30);
  assert.equal(evidence.formulas.mashTaps,
    'max(1, mashQTENumTaps(30) − Bonus(PetTapCountToAttack))');
  const s = armed();
  assert.equal(petBurstTaps(s), 30 - Math.floor(effect(s.tt2, 'PetTapCountToAttack')));
  assert.ok(petBurstTaps(s) >= 1);
  // 那三十下與平常寵物蓄力的二十下是兩個不同的數字，limits 裡也釘住了。
  assert.match(evidence.limits.join('\n'), /兩個不同的數字/);
});

test('下限的 1 現在驗不出來，因為唯一的來源最多只減 15', () => {
  // 變異驗證在這裡驗不出來：把 max(1, …) 拿掉，行為完全相同。
  // 這不是測試的漏洞，是這份資料下無法區分——把前提釘住，
  // 哪天有來源能把減免推到 30 以上，這個測試會先轉紅。
  const sources = TT2_TREE.flatMap(k =>
    (k.effects ?? []).filter(e => e.type === 'PetTapCountToAttack')
      .map(e => ({ id: k.id, max: Math.max(...e.values) })));
  assert.deepEqual(sources, [{ id: 'PetDmg', max: 15 }],
    'PetTapCountToAttack 只有天賦「寵物傷害」一個來源');
  const s = armed();
  TT2_TREE.forEach((k, i) => { s.tt2.tree[i] = k.max; });
  assert.ok(effect(s.tt2, 'PetTapCountToAttack') < 30,
    '減免碰不到 30，所以下限那一步永遠不會作用');
  assert.equal(petBurstTaps(s), 30 - effect(s.tt2, 'PetTapCountToAttack'));
});

test('雷霆爆發不跳泰坦，但會跳關', () => {
  assert.equal(evidence.formulas.burstTitanSkip,
    '沒有這一支：DamageType.PetBurst 落在 GetTitanSkip 的 default，回 0');
  assert.deepEqual(evidence.skipArms.titanSkip.petBurstBonuses, ['TitanSkipMult'],
    'default 那條路上只剩倍率，沒有任何 skip 來源被加進去');
  assert.deepEqual(evidence.skipArms.titanSkip.controlArmPet, ['TitanSkip', 'PetAttackTitanSkip'],
    '對照組：寵物平常那一擊確實有自己的那一支');
  assert.deepEqual(evidence.skipArms.stageSkip.petBurstBonuses, ['StageSkip', 'PetQTEStageSkip']);

  const s = armed();
  assert.equal(titanSkip(s, 'petBurst'), 0, '再怎麼投資都不跳泰坦');
  assert.ok(stageSkip(s, 'petBurst') > 0, '滿級的雷霆爆發應該跳得了關');
  // 平常那一擊仍然照自己的來源算，沒有被這一支影響。
  assert.ok(titanSkip(s, 'pet') >= 0);
});

test('沒學天賦就不排程，學了才進冷卻', () => {
  const bare = fresh(1000);
  bare.best = 50;
  assert.equal(qteUnlocked(bare.tt2, QTE_TYPE.PetAttack), false);
  advance(bare, bare.last + 10000);
  assert.equal(bare.tt2.qteReadyAt[QTE_TYPE.PetAttack], -1, '鎖著就不排程');

  const s = armed();
  advance(s, s.last + 5000);
  assert.ok(s.tt2.qteReadyAt[QTE_TYPE.PetAttack] > s.last, '學了就開始冷卻');
});

test('連打滿了才放大攻擊，放完回到冷卻', () => {
  const s = armed();
  waitForBurst(s);
  assert.equal(qteReady(s.tt2, QTE_TYPE.PetAttack), true);
  const need = petBurstTaps(s);
  assert.ok(need >= 1);

  // 差一下的時候還不能放。
  for (let n = 0; n < need - 1; n++) apply(s, { type: 'tap', at: s.last + 50 });
  assert.equal(s.tt2.qteTaps, need - 1, '每一下點擊都算一次');
  assert.equal(qteReady(s.tt2, QTE_TYPE.PetAttack), true, '還沒打滿就還在 ready');

  apply(s, { type: 'tap', at: s.last + 50 });
  assert.equal(s.tt2.qteTaps, 0, '放完就歸零');
  assert.equal(qteReady(s.tt2, QTE_TYPE.PetAttack), false, '放完回到冷卻');
  assert.ok(s.tt2.qteReadyAt[QTE_TYPE.PetAttack] > s.last);
});

test('沒打滿就過期的話，進度不會留到下一輪', () => {
  const s = armed();
  waitForBurst(s);
  apply(s, { type: 'tap', at: s.last + 50 });
  assert.equal(s.tt2.qteTaps, 1);
  // 放著不打，等它過期。
  const flies = s.tt2.qteExpireAt[QTE_TYPE.PetAttack];
  while (qteReady(s.tt2, QTE_TYPE.PetAttack) && s.last < flies + 20000) advance(s, s.last + 3000);
  assert.equal(qteReady(s.tt2, QTE_TYPE.PetAttack), false, '過期了');
  assert.equal(s.tt2.qteTaps, 0, '下一輪要從頭數');
});

test('沒有出戰的傷害寵物就不累積連打', () => {
  const s = armed();
  s.tt2.activePets[0] = -1;
  waitForBurst(s);
  apply(s, { type: 'tap', at: s.last + 50 });
  assert.equal(s.tt2.qteTaps, 0, '沒有寵物在場就不該累積');
});

test('閃現做了也不會生效，理由記在證據裡', () => {
  // ApplyChargedBonus 第一件事就是拿 duration 跟 0 比，不大於 0 就整個返回。
  assert.equal(evidence.formulas.flashZipGate,
    'Bonus(PetBossQTEDuration) > 0 才套用，否則整個方法直接返回');
  const charged = evidence.traces.chargedBonus
    .filter(e => e[0] === 'GetBonus' || e[0] === 'ModifyBonus' || e[0] === 'call').slice(0, 4);
  assert.deepEqual(charged.map(e => [e[0], e[1]]),
    [['GetBonus', 'PetBossQTEDuration'], ['call', 'op_Implicit'],
      ['call', 'op_GreaterThan'], ['GetBonus', 'PetBossQTEDamage']],
    '閘門在前，傷害在後');
  // 而本專案沒有任何來源給那個持續時間，所以閘門永遠關著。
  assert.equal(rows.PetBossQTEDuration.sources, null,
    '哪天有來源了，這裡會轉紅，表示閃現可以做了');
  assert.ok(evidence.blocked.PetBoss.includes('永遠關著'));
  assert.equal(TT2_QTE[QTE_TYPE.PetBoss].talent, 'BossDmgQTE', '天賦本身是存在的，缺的是 duration');
});

test('米達斯之心是缺前置，不是做不了', () => {
  const calls = evidence.traces.homGold.filter(e => e[0] === 'call').map(e => e[1]);
  assert.ok(calls.includes('GetAverageBossGoldDrop'));
  assert.ok(calls.includes('GetStageScaleGoldAmount'));
  assert.ok(evidence.deferred.PetGold.includes('GetStageScaleGoldAmount'));
  // 那條金幣縮放同時也是妖精缺的四項之一，所以是一段獨立的工作。
  assert.match(evidence.deferred.PetGold, /妖精/);
});

test('OnQTEReady 只處理寵物的兩型，閃現走別的入口', () => {
  const arms = evidence.traces.petReady
    .filter(e => e[0] === 'cmp' && /^w20, #\d+$/.test(e[1]))
    .map(e => Number(e[1].split('#')[1]));
  assert.deepEqual(arms.sort(), [QTE_TYPE.PetAttack, QTE_TYPE.PetGold]);
});

test('接上的加成真的有來源，沒接的沒有', () => {
  assert.ok(rows.PetAttackQTEDamage.sources?.length, '雷霆爆發的傷害要有來源，否則接了沒用');
  assert.ok(rows.PetQTEStageSkip.sources?.length);
  assert.equal(rows.PetQTEDamage.nativeReaders, null, '原生沒有取值點，所以沒接');
  assert.match(evidence.limits.join('\n'), /PetQTEDamage/);
});

test('妖精那一型沒有被這一段影響', () => {
  const s = armed();
  s.best = FAIRY.startStage;
  advance(s, s.last + 5000);
  assert.ok(s.tt2.qteReadyAt[QTE_TYPE.Fairy] > s.last, '妖精照樣自己排程');
  assert.equal(s.tt2.qteTaps, 0, '連打的計數只屬於雷霆爆發');
});
