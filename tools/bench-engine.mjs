// Times the engine's hot paths on a heavy save, with no browser in the way.
//
// The browser is the wrong place to measure this: on a loaded machine the main-thread samples swing
// by a factor of two, which is wider than the effect being measured. These numbers are stable enough
// to compare before and after a change. Run with Node 24:
//   node tools/bench-engine.mjs
import { fresh, hydrate, advance, apply, dps, tapDamage } from '../lib/engine.ts';

/** Stage 1200, every hero at 800, 60 artifacts, the talent tree full, 30 pets and a full bag. */
function heavy(bag = 100) {
  const s = hydrate(fresh(Date.now()));
  const t = s.tt2;
  s.stage = 1200; s.best = 1200; s.level = 800; s.prestiges = 40; s.relics = 5e6; s.diamonds = 90000; s.dust = 50000;
  s.heroes = s.heroes.map(() => 800); s.weapons = s.weapons.map(() => 20); s.evolutions = s.evolutions.map(() => 3);
  s.skillLevels = s.skillLevels.map(() => 30);
  t.artifacts = t.artifacts.map((_, i) => (i < 60 ? 400 : 0));
  t.spent = t.spent.map((_, i) => (i < 60 ? 1e6 : 0));
  t.tree = t.tree.map(() => 20); t.earnedPoints = 1320;
  t.petLevels = t.petLevels.map(() => 60); t.activePets = [0, 1];
  t.scrolls = t.scrolls.map(() => 10);
  t.inventory = Array.from({ length: bag }, (_, i) => ({ id: i + 1, definition: i % 160, level: 120 }));
  t.nextGearId = bag + 1;
  t.equipped = bag ? [1, 2, 3, 4, 5] : [-1, -1, -1, -1, -1];
  t.shards = 20000; t.cards = 500; t.mana = 500;
  return s;
}

/** Median of seven rounds, so one slow round does not decide the answer. */
function perCall(state, runs, fn) {
  fn(state);
  const rounds = [];
  for (let round = 0; round < 7; round += 1) {
    const started = process.hrtime.bigint();
    for (let i = 0; i < runs; i += 1) fn(state);
    rounds.push(Number(process.hrtime.bigint() - started) / 1e6 / runs);
  }
  rounds.sort((a, b) => a - b);
  return { median: rounds[3], min: rounds[0], max: rounds[6] };
}

const full = heavy();
console.log('重度存檔（關卡 1200、英雄 800 級、60 件神器、天賦全滿、背包 100 件）');
for (const [label, fn] of [
  ['dps()', s => dps(s)],
  ['tapDamage()', s => tapDamage(s)],
  ['advance() 100ms', s => advance(s, s.last + 100)],
  ['apply() 一次點擊', s => apply(s, { type: 'tap', at: s.last + 50 })],
]) {
  const { median, min, max } = perCall(full, 200, fn);
  console.log(`  ${label.padEnd(18)} ${median.toFixed(3)} ms  (min ${min.toFixed(3)}, max ${max.toFixed(3)})`);
}

console.log('背包件數對 dps() 的影響（只有加成快取的檢查會隨件數變長）');
for (const bag of [0, 25, 50, 100]) {
  console.log(`  ${String(bag).padStart(3)} 件            ${perCall(heavy(bag), 200, s => dps(s)).median.toFixed(3)} ms`);
}
