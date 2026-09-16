import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fresh, hydrate, advance, dps } from '../lib/engine.ts';
import { toNumber } from '../lib/big-number.ts';
import { BATTLE_INTERVAL, redraws } from '../lib/ui-cadence.ts';

const source = readFileSync(new URL('../app/game.tsx', import.meta.url), 'utf8');

test('只有隱藏的分頁不重繪，其餘狀態都要畫', () => {
  assert.equal(BATTLE_INTERVAL, 100);
  assert.equal(redraws('hidden'), false);
  assert.equal(redraws('visible'), true);
  // Chrome also reports 'prerender'; anything that is not hidden keeps drawing.
  assert.equal(redraws('prerender'), true);
});

test('戰鬥迴圈用這個間隔，而且隱藏分頁只跳過重繪、不跳過模擬', () => {
  assert.ok(source.includes('},BATTLE_INTERVAL);'), '戰鬥迴圈沒有使用 BATTLE_INTERVAL');
  const tick = source.slice(source.indexOf('const tick=setInterval('), source.indexOf('},BATTLE_INTERVAL);'));
  const advanceAt = tick.indexOf('advance(state.current,');
  const redrawAt = tick.indexOf('redraws(document.visibilityState)');
  assert.ok(advanceAt >= 0, '迴圈裡沒有推進模擬');
  assert.ok(redrawAt > advanceAt, '可見性判斷擋在模擬前面，背景遊玩會掉到離線結算');
  assert.ok(tick.indexOf('setS(') > redrawAt, '隱藏時仍會重繪');
  // Coming back to a visible tab has to draw at once instead of waiting for the next frame.
  assert.ok(source.includes("const visibility=()=>{if(document.visibilityState==='hidden'){void save();return;}"), '回到前景沒有立刻補畫面');
});

test('背景時照常推進的一秒，結果與前景每 100 毫秒推進一次相同', () => {
  // The loop keeps its cadence whether or not it draws, so both paths take the same per-100ms walk.
  const start = Date.now();
  const drawn = hydrate(fresh(start));
  const hidden = hydrate(fresh(start));
  for (const s of [drawn, hidden]) {
    s.stage = 400; s.best = 400; s.level = 300;
    s.heroes = s.heroes.map(() => 200);
    s.tt2.artifacts = s.tt2.artifacts.map((_, i) => (i < 20 ? 30 : 0));
  }
  for (let i = 1; i <= 10; i += 1) advance(drawn, start + i * BATTLE_INTERVAL);
  for (let i = 1; i <= 10; i += 1) advance(hidden, start + i * BATTLE_INTERVAL);
  assert.equal(hidden.last, drawn.last);
  assert.equal(toNumber(hidden.gold), toNumber(drawn.gold));
  assert.equal(toNumber(dps(hidden)), toNumber(dps(drawn)));
});

test('一秒的空檔仍走每 100 毫秒的模擬，不會掉到離線結算', () => {
  // A hidden tab is throttled to about one timer a second; the offline settlement only takes over
  // past 30 seconds, so the cadence has to stay well inside that.
  const start = Date.now();
  const stepped = hydrate(fresh(start));
  const throttled = hydrate(fresh(start));
  for (const s of [stepped, throttled]) { s.stage = 400; s.best = 400; s.level = 300; s.heroes = s.heroes.map(() => 200); }
  for (let i = 1; i <= 10; i += 1) advance(stepped, start + i * 100);
  advance(throttled, start + 1000);
  assert.equal(throttled.last, stepped.last);
  assert.equal(toNumber(throttled.gold), toNumber(stepped.gold), '一秒一次的推進結果與十次 100 毫秒不同');
});
