import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fresh, hydrate, apply, buildDamage } from '../lib/engine.ts';
import { petRequiredTaps } from '../lib/tt2-pet-combat.ts';
import { compare, ZERO } from '../lib/big-number.ts';

const source = readFileSync(new URL('../app/game.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

/** A save with a damage pet on the field and the heavenly strike ready. */
function armed() {
  const s = hydrate(fresh(1000));
  s.stage = 40; s.best = 400; s.level = 600;
  s.heroes = s.heroes.map(() => 100);
  s.skillLevels = s.skillLevels.map(() => 5);
  s.tt2.petLevels = s.tt2.petLevels.map(() => 30);
  s.tt2.activePets = [0, 1];
  s.tt2.mana = 1e6;
  return s;
}

test('寵物攻擊會在某一次點擊當下發動，那一格才有數字可顯示', () => {
  const s = armed();
  const needed = petRequiredTaps(s.tt2);
  assert.ok(needed > 0, '寵物需要的點擊數應為正');
  let firedOn = -1;
  let at = s.last;
  for (let i = 0; i < needed * 2; i += 1) {
    const before = s.tt2.petAttacks;
    at += 50;
    apply(s, { type: 'tap', at });
    if (s.tt2.petAttacks > before && firedOn < 0) firedOn = i + 1;
  }
  assert.equal(firedOn, needed, `寵物在第 ${firedOn} 次點擊發動，預期第 ${needed} 次`);
  // The damage of that swipe is what the interface shows, so it has to be a real number.
  assert.ok(compare(s.tt2.lastPetHit, { ...ZERO }) > 0, '寵物傷害沒有被記下來');
});

test('天堂聖擊發動時計數會加一，傷害算得出來', () => {
  const s = armed();
  const before = s.tt2.heavenlyStrikes;
  apply(s, { type: 'skill', index: 5, at: s.last + 100 });
  assert.equal(s.tt2.heavenlyStrikes, before + 1, '技能沒有發動');
  assert.ok(compare(buildDamage(s, 'heavenly'), { ...ZERO }) > 0, '天堂傷害為零');
  // Pressing it again on cooldown must not count, or the interface would show a phantom number.
  const after = s.tt2.heavenlyStrikes;
  apply(s, { type: 'skill', index: 5, at: s.last + 150 });
  assert.equal(s.tt2.heavenlyStrikes, after, '冷卻中仍然計數');
});

test('介面用計數器的變化決定要不要冒出數字，而不是自己猜', () => {
  // Reading the counters means a number appears exactly when the engine actually dealt that damage.
  assert.ok(source.includes('const attacks=state.current.tt2?.petAttacks||0;'), '點擊前沒有記下寵物攻擊次數');
  assert.ok(source.includes('if(t&&t.petAttacks>attacks)'), '沒有用寵物攻擊次數判斷');
  assert.ok(source.includes("const strikes=state.current.tt2?.heavenlyStrikes||0;"), '動作前沒有記下天堂聖擊次數');
  assert.ok(source.includes("(state.current.tt2?.heavenlyStrikes||0)>strikes"), '沒有用天堂聖擊次數判斷');
  assert.ok(source.includes("float(`⚡ ${fmt(t.lastPetHit)}`,'pet'"), '寵物傷害沒有用引擎記下的數值');
  assert.ok(source.includes("buildDamage(state.current,'heavenly')"), '天堂傷害沒有用引擎的算式');
});

test('三種傷害數字各有自己的樣式，不會看起來一樣', () => {
  for (const kind of ['crit', 'pet', 'heavenly']) {
    assert.ok(css.includes(`.damage-number.${kind}{`), `缺少 .damage-number.${kind} 樣式`);
  }
  const colour = kind => (css.match(new RegExp(`\\.damage-number\\.${kind}\\{color:(#[0-9a-f]+)`)) || [])[1];
  const colours = ['crit', 'pet', 'heavenly'].map(colour);
  assert.ok(colours.every(Boolean), `有樣式沒有指定顏色：${colours}`);
  assert.equal(new Set(colours).size, colours.length, `顏色重複：${colours}`);
});
