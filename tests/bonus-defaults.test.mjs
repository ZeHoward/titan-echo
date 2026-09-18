import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { fresh, critChance, critMultiplier, cloneAttackRate, BONUS_DEFAULTS } from '../lib/engine.ts';

const evidence = JSON.parse(readFileSync(new URL('bonus-defaults-evidence.json', referenceRoot), 'utf8'));
const statics = JSON.parse(readFileSync(new URL('servervar-defaults.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
});

test('十四個加成的基礎值全部配對到一個具名的靜態欄位', () => {
  assert.equal(Object.keys(evidence.defaults).length, 14);
  assert.deepEqual(evidence.unresolved, [], '有配不起來的就要列出來，不是省略');
  for (const [bonus, entry] of Object.entries(evidence.defaults)) {
    assert.ok(entry.field, `${bonus} 沒有來源欄位`);
    assert.match(entry.offset, /^0x[0-9a-f]+$/, bonus);
    // The value must be the same number the whole-statics walk recovered for that field.
    assert.equal(entry.value, statics.recovered[entry.field].value, bonus);
  }
});

test('引擎用的基礎值就是這張表上的值', () => {
  assert.equal(BONUS_DEFAULTS.critChance, Math.fround(evidence.defaults.CritChance.value));
  assert.equal(BONUS_DEFAULTS.chestChance, Math.fround(evidence.defaults.ChestChance.value));
  assert.equal(BONUS_DEFAULTS.cloneAttackRate, evidence.defaults.ShadowCloneSkillAttackRate.value);
  assert.equal(evidence.defaults.CritChance.field, 'playerCritChance');
  assert.equal(evidence.defaults.ChestChance.field, 'chestersonChance');
  assert.equal(evidence.defaults.ShadowCloneSkillAttackRate.field, 'baseShadowCloneAniPerSec');
});

test('乾淨存檔算出來的三個數字，與原生預設值一致', () => {
  const s = fresh(1000);
  assert.equal(critChance(s), BONUS_DEFAULTS.critChance);
  assert.equal(critMultiplier(s), statics.recovered.playerCritMult.value);
  assert.equal(cloneAttackRate(s), 4);
  // The cap the original applies to the crit chance.
  assert.equal(statics.recovered.maxCritChance.value, 1);
});

test('機率會被全機率加成放大，就像原生那樣', () => {
  const s = fresh(1000);
  const boost = 'AllProbabilityBoost';
  // With no source of the boost it resolves to 1 and changes nothing.
  assert.equal(critChance(s), BONUS_DEFAULTS.critChance);
  // The engine multiplies rather than ignores it: this is the shape PlayerModel uses.
  const source = readFileSync(new URL('../lib/engine.ts', import.meta.url), 'utf8');
  assert.ok(source.includes(`stateEffect(s,'${boost}')`), '暴擊機率沒有乘上全機率加成');
  // The two special-titan rolls share one template: own factor x SpecialTitanSpawnChance x boost.
  for (const [fn, own] of [['chestChance', 'ChestChance'], ['megaBombChance', 'MegaBombSpawnChance']]) {
    const at = source.indexOf(`export function ${fn}(s:State,resolve=stateResolver(s)){`);
    assert.ok(at > 0, `${fn} 不見了`);
    const body = source.slice(at, source.indexOf('}', at) + 1);
    for (const factor of [own, 'SpecialTitanSpawnChance', boost]) {
      assert.ok(body.includes(`resolve('${factor}')`), `${fn} 少乘了 ${factor}`);
    }
  }
});

test('尚未接進引擎的基礎值先記錄下來', () => {
  // Seven of the fourteen are live now: the three original ones, the two multi-titan spawn bonuses
  // (2.16.0) and the two mega bomb ones (2.17.0). The rest are recorded so the next mechanic that
  // needs one does not invent it: the mana titan, the x10 gold roll, the stage-skip titan and the
  // dual pet burst.
  for (const [bonus, value] of [['StageSkipMonsterSpawnChance', 0.001],
    ['Goldx10Chance', 0.01], ['ManaMonsterAmount', 4], ['DualPetAttackCountToBurst', 5]]) {
    assert.ok(Math.abs(evidence.defaults[bonus].value - value) < 1e-6, bonus);
  }
  assert.match(evidence.limits.join(''), /基礎值/);
});
