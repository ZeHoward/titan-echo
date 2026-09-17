import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { fresh, hydrate, apply, advance, buildDamage, cloneAttackRate, SKILLS } from '../lib/engine.ts';
import { toNumber, ZERO, compare } from '../lib/big-number.ts';
import { TT2_TREE } from '../lib/tt2-data.ts';
import { DAMAGE_TEXT_DEFAULTS, DAMAGE_TEXT_OPTIONS, normaliseDamageText, showsDamageText } from '../lib/damage-text.ts';

const evidence = JSON.parse(readFileSync(new URL('damage-text-evidence.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
  assert.match(evidence.binarySha256, /^[0-9a-f]{64}$/);
  assert.match(evidence.scriptSha256, /^[0-9a-f]{64}$/);
});

test('41 個傷害來源各自只歸一個顯示選項，其餘七個永遠顯示', () => {
  assert.equal(Object.keys(evidence.damageTypes).length, 41);
  assert.equal(evidence.damageTypes.Test, 0);
  const options = Object.values(evidence.damageText.byOption);
  assert.equal(options.length, 8);
  const routed = options.flatMap(option => option.damageTypes);
  assert.equal(new Set(routed).size, routed.length, '同一個來源被兩個選項管');
  assert.equal(routed.length + evidence.damageText.alwaysShown.length, 40, 'Test 之外的來源要全部分完');
  assert.deepEqual(evidence.damageText.alwaysShown,
    ['Helper', 'HelperCrit', 'HelperEnhanced', 'HelperEnhancedCrit', 'HelperQTE', 'Splash', 'ActiveSkillMegaCoin']);
  // The switch is a jump table over damageType − 1, so its length is the enum's top value.
  assert.equal(evidence.damageText.switchTable.length, 40);
});

test('本專案的四個開關與原生欄位、原生歸類逐項相同', () => {
  assert.equal(DAMAGE_TEXT_OPTIONS.length, 4);
  for (const option of DAMAGE_TEXT_OPTIONS) {
    const native = evidence.damageText.byOption[option.nativeField];
    assert.ok(native, `${option.nativeField} 不在證據裡`);
    assert.deepEqual(option.damageTypes, native.damageTypes, option.key);
  }
  // The builds behind the other four options are not implemented, so they are not offered.
  const offered = new Set(DAMAGE_TEXT_OPTIONS.map(option => option.nativeField));
  for (const field of ['clanShipDamageTextOff', 'daggerDamageTextOff', 'goldGunDamageTextOff', 'specialAttackDamageTextOff']) {
    assert.ok(evidence.damageText.byOption[field], field);
    assert.ok(!offered.has(field), `${field} 沒有對應的實作卻做成開關`);
  }
});

test('預設全部顯示，關掉一個只影響它自己的數字', () => {
  assert.deepEqual(DAMAGE_TEXT_DEFAULTS, { swordMaster: true, pet: true, heavenlyStrike: true, shadowClone: true });
  assert.deepEqual(normaliseDamageText(null), DAMAGE_TEXT_DEFAULTS);
  assert.deepEqual(normaliseDamageText({ pet: 'no' }), DAMAGE_TEXT_DEFAULTS, '壞值要當成顯示');
  const settings = normaliseDamageText({ pet: false });
  assert.equal(showsDamageText(settings, 'pet'), false);
  for (const kind of ['tap', 'crit', 'heavenly', 'clone']) assert.equal(showsDamageText(settings, kind), true);
  // A tap crit is the Sword Master's own hit in the original's grouping, so one switch covers both.
  const noTaps = normaliseDamageText({ swordMaster: false });
  assert.equal(showsDamageText(noTaps, 'tap'), false);
  assert.equal(showsDamageText(noTaps, 'crit'), false);
  // Anything no option covers is drawn, the way the helper family always shows.
  assert.equal(showsDamageText(normaliseDamageText({}), 'gold'), true);
});

test('受擊動畫是另一份名單：25 個來源會播，暴擊變體多半不播', () => {
  assert.equal(evidence.damagedAnimation.plays.length, 25);
  for (const name of ['Tap', 'TapCrit', 'Pet', 'ActiveSkillHeavenlyStrike', 'ActiveSkillShadowClone']) {
    assert.ok(evidence.damagedAnimation.plays.includes(name), name);
  }
  for (const name of ['PetCrit', 'ActiveSkillHeavenlyStrikeCrit', 'ActiveSkillShadowCloneCrit']) {
    assert.ok(evidence.damagedAnimation.skips.includes(name), name);
  }
  assert.equal(evidence.damagedAnimation.plays.length + evidence.damagedAnimation.skips.length, 41);
});

test('十個受擊染色在包內有值，但沒有任何方法讀它們', () => {
  const tints = evidence.monsterTints;
  assert.equal(Object.keys(tints.colours).length, 10);
  assert.equal(tints.readers.reads, 0);
  assert.equal(tints.readers.scannedMethods, 47, 'MonsterController 的其餘方法都掃過了');
  // The negative result is the point: these must not be dressed up as the original's hit colours.
  const sources = [...readdirSync(new URL('../lib/', import.meta.url)).map(name => `../lib/${name}`),
    '../app/globals.css', '../app/game.tsx'];
  for (const relative of sources) {
    if (!/\.(ts|tsx|css)$/.test(relative)) continue;
    const text = readFileSync(new URL(relative, import.meta.url), 'utf8').toUpperCase();
    for (const [name, colour] of Object.entries(tints.colours)) {
      assert.ok(!text.includes(colour.hex.toUpperCase()), `${relative} 用了未被原版讀取的 ${name}`);
    }
  }
});

test('影分身速率是 max(1, 攻擊速率加成 × 同伴攻擊速率)，基礎每秒四次', () => {
  assert.deepEqual(evidence.shadowClone.rate.bonuses, ['ShadowCloneSkillAttackRate', 'CompanionAttackRate']);
  // The base is not 1: BonusModel.SetDefaultBonuses seeds ShadowCloneSkillAttackRate from
  // baseShadowCloneAniPerSec, which is 4.
  const bonuses = JSON.parse(readFileSync(new URL('bonus-defaults-evidence.json', referenceRoot), 'utf8'));
  assert.equal(bonuses.defaults.ShadowCloneSkillAttackRate.value, 4);
  assert.equal(bonuses.defaults.ShadowCloneSkillAttackRate.field, 'baseShadowCloneAniPerSec');
  const s = fresh(1000);
  assert.equal(cloneAttackRate(s), 4);
  const talent = TT2_TREE.findIndex(k => k.effects.some(e => e.type === 'ShadowCloneSkillAttackRate'));
  assert.ok(talent >= 0, '資料表裡沒有提供攻擊速率的天賦');
  s.tt2.tree[talent] = 3;
  assert.ok(cloneAttackRate(s) > 4, '天賦應提高速率');
  assert.equal(cloneAttackRate(s), 4 + TT2_TREE[talent].effects
    .find(e => e.type === 'ShadowCloneSkillAttackRate').values[3]);
});

/** A player who can cast the shadow clone, with heroes worth cloning. */
const caster = (now = 1000) => {
  const s = fresh(now);
  s.level = SKILLS[0].level + 50;
  s.skillLevels[0] = 3;
  s.heroes = s.heroes.map(() => 50);
  return s;
};

test('技能施放後影分身按自己的節奏攻擊，一次一秒', () => {
  const cast = apply(caster(), { type: 'skill', index: 0, at: 1000 });
  assert.ok(cast.active[0] > cast.last, '技能沒有進入施放中');
  assert.equal(cast.tt2.cloneAttacks, 0, '施放的那一刻還沒打');
  assert.equal(cast.tt2.cloneAt, 1000, '計時從施放那一刻開始');
  const after = advance(cast, 1000 + 10_000);
  assert.equal(after.tt2.cloneAttacks, 40, '四次一秒，十秒四十次');
  assert.ok(compare(after.tt2.lastCloneHit, ZERO) > 0, '最後一次攻擊要留下數字');
  // buildDamage is this project's per-second figure, so one swing is that over the rate: four
  // swings a second still add up to the same damage per second as the old silent tick.
  const perSecond = toNumber(buildDamage(after, 'clone')), landed = toNumber(after.tt2.lastCloneHit);
  const expected = perSecond/cloneAttackRate(after);
  assert.ok(landed > expected/2 && landed < expected*2, `一擊應是每秒總量的四分之一，得到 ${landed} 對 ${expected}`);
});

test('節奏不隨模擬步長改變：一次跳三秒與走三十步結果相同', () => {
  const once = advance(apply(caster(), { type: 'skill', index: 0, at: 1000 }), 4000);
  const stepped = (() => {
    let s = apply(caster(), { type: 'skill', index: 0, at: 1000 });
    for (let at = 1100; at <= 4000; at += 100) s = advance(s, at);
    return s;
  })();
  assert.equal(once.tt2.cloneAttacks, 12, '三秒、每秒四次');
  assert.equal(stepped.tt2.cloneAttacks, once.tt2.cloneAttacks);
});

test('沒有施放影分身就不會有影分身攻擊', () => {
  const idle = advance(caster(), 1000 + 10_000);
  assert.equal(idle.tt2.cloneAttacks, 0);
  assert.equal(compare(idle.tt2.lastCloneHit, ZERO), 0);
});

test('技能結束後停止，不會因為計時器落後而補打', () => {
  const cast = apply(caster(), { type: 'skill', index: 0, at: 1000 });
  const duration = cast.active[0] - cast.last;
  assert.equal(duration, 60_000, '影分身持續 60 秒（ActiveSkillInfo）');
  // Ten seconds a step: a single 60s jump would fall to the offline settlement, which ends skills.
  let s = cast;
  for (let at = 1000 + 10_000; at <= 1000 + duration; at += 10_000) s = advance(s, at);
  const attacks = s.tt2.cloneAttacks;
  assert.equal(attacks, 239, '每秒四次；最後一次的時點與技能結束同一步，那一步已不算施放中');
  for (let at = 1000 + duration + 10_000; at <= 1000 + duration + 30_000; at += 10_000) s = advance(s, at);
  assert.equal(s.tt2.cloneAttacks, attacks);
});

test('舊存檔沒有這三個欄位也能讀，蛻變後最後一擊歸零', () => {
  const saved = JSON.parse(JSON.stringify(caster()));
  delete saved.tt2.cloneAt;
  delete saved.tt2.cloneAttacks;
  delete saved.tt2.lastCloneHit;
  const repaired = hydrate(saved);
  assert.equal(typeof repaired.tt2.cloneAt, 'number');
  assert.equal(repaired.tt2.cloneAttacks, 0);
  assert.equal(compare(repaired.tt2.lastCloneHit, ZERO), 0);

  const ready = caster();
  ready.best = 120;
  ready.stage = 120;
  const cast = advance(apply(ready, { type: 'skill', index: 0, at: 1000 }), 3000);
  assert.ok(cast.tt2.cloneAttacks > 0);
  const reborn = apply(cast, { type: 'prestige', at: 3000 });
  assert.equal(compare(reborn.tt2.lastCloneHit, ZERO), 0);
});
