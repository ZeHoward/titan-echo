import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceRoot } from '../tools/reference-validation.mjs';
import { loadRegister } from '../tools/formula-sources.mjs';
import { fresh, heroDps, HEROES } from '../lib/engine.ts';
import { toNumber } from '../lib/big-number.ts';
import { TT2_HEROES, TT2_HERO_MILESTONES } from '../lib/tt2-data.ts';

const evidence = JSON.parse(readFileSync(new URL('hero-dps-evidence.json', referenceRoot), 'utf8'));
const improvements = JSON.parse(readFileSync(new URL('HelperImprovementsInfo.json', referenceRoot), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../docs/reference-baseline.json', import.meta.url), 'utf8'));

test('證據取自釘住的那份安裝包，不是別的版本', () => {
  assert.equal(evidence.version, '8.2.0');
  assert.equal(evidence.packageSha256, baseline.package.sha256);
  assert.match(evidence.binarySha256, /^[0-9a-f]{64}$/);
});

test('原生的英雄傷害是三個因子相乘，沒有第四項', () => {
  assert.deepEqual(evidence.rawDps.calls, [
    'HelperInfo$$GetLevellingCurve',
    'LevelCurve$$GetTotalImprovementByLevel',
    'GHDouble$$op_Implicit',
    'GHDouble$$op_Multiply',
    'HelperInfo$$GetBaseDamage',
    'GHDouble$$op_Multiply',
  ]);
  // The strongest form of the claim: neither method loads a floating-point constant at all, so no
  // per-level growth rate can be hiding in the native path.
  assert.deepEqual(evidence.rawDps.floatConstants, []);
  assert.deepEqual(evidence.fullDps.floatConstants, []);
  // The full DPS only adds the weapon, the all-hero share and the enhancement on the outside.
  for (const call of ['HelperInfo$$GetWeaponDamage', 'HelperModel$$GetAllHelperDPS',
    'HelperModel$$GetIndividualEnhancedMultiplier']) {
    assert.ok(evidence.fullDps.calls.includes(call), call);
  }
});

test('引擎的里程碑表就是安裝包 Ascension 0 的累計倍率，逐列相同', () => {
  const rows = improvements.records.map(record => record.values).filter(row => row.Ascension === '0');
  assert.equal(rows.length, TT2_HERO_MILESTONES.length);
  assert.equal(rows.length, evidence.improvementTable.ascension0Rows);
  rows.forEach((row, index) => {
    const mine = TT2_HERO_MILESTONES[index];
    assert.equal(mine.level, Number(row.Level), `第 ${index} 列的等級`);
    for (const kind of ['Melee', 'Ranged', 'Spell']) {
      assert.equal(mine[kind], Number(row['PrecalculatedAmount'+kind]), `第 ${index} 列的 ${kind}`);
    }
  });
});

test('引擎目前比原生多乘了 1.035^(等級−1)，其餘因子與原生一致', () => {
  // A clean save: no artifacts, talents, pets, equipment or weapons, so every bonus resolves to 1
  // and what is left is exactly the three native factors plus the 7.5 growth rate.
  const s = fresh(1000);
  const index = TT2_HEROES.findIndex(hero => hero.kind === 'Melee');
  assert.ok(index >= 0);
  const kind = TT2_HEROES[index].kind;
  for (const level of [1, 10, 50, 200, 1000]) {
    s.heroes = s.heroes.map((_, i) => (i === index ? level : 0));
    const milestone = TT2_HERO_MILESTONES.findLast(m => m.level <= level)?.[kind] || 1;
    const native = HEROES[index].power * level * milestone;
    const ratio = toNumber(heroDps(s, index)) / native;
    assert.ok(Math.abs(ratio / 1.035 ** (level - 1) - 1) < 1e-9,
      `等級 ${level} 的差距應正好是 1.035^(等級−1)，得到 ${ratio}`);
  }
});

test('這個差異登記為 table-differs，理由與影響寫在登記表裡', () => {
  const register = loadRegister();
  const hero = register.formulas.find(formula => formula.id === 'heroDamage');
  const growth = hero.parts.find(part => part.part.includes('1.035'));
  assert.equal(growth.status, 'table-differs', '偏差必須登記，不能當成已核實');
  assert.equal(growth.ref, 'hero-dps-evidence.json');
  // Why it is not simply removed: the monster curve it is paired with has no native values either.
  assert.match(growth.note, /GetRawDPS/);
  assert.match(growth.note, /1\.32/);
  // The package disagrees with the engine in several places now; this is one of them, and the list
  // is asserted whole so a new one cannot slip in unrecorded.
  const differs = register.formulas.flatMap(formula =>
    formula.parts.filter(part => part.status === 'table-differs').map(() => formula.id));
  assert.deepEqual(differs.sort(),
    ['bossHealthMod', 'heroDamage', 'monsterGold', 'monsterHealth', 'monsterHealth', 'perks',
      'perks', 'petBonus', 'prestigeRelics', 'prestigeRelics', 'prestigeRelics', 'qteCooldown',
      'skillPoints']);
});
