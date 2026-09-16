import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fresh, hydrate, advance, dps } from '../lib/engine.ts';
import { toNumber } from '../lib/big-number.ts';
import { BATTLE_INTERVAL, PANEL_INTERVAL, panelDue, panelSyncsOn, redraws } from '../lib/ui-cadence.ts';
import { ACTION_TYPES } from '../lib/content.ts';

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
  const visibility = source.slice(source.indexOf('const visibility=()=>{'), source.indexOf("document.addEventListener('visibilitychange'"));
  assert.ok(visibility.includes("document.visibilityState==='hidden'"), '可見性處理不見了');
  assert.ok(visibility.includes('void save();return;'), '隱藏時沒有先存檔就返回');
  assert.ok(visibility.includes('setS('), '回到前景沒有立刻補畫面');
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

test('升級面板的重繪間隔比戰鬥區長，而且是整數倍', () => {
  assert.ok(PANEL_INTERVAL > BATTLE_INTERVAL, '面板間隔沒有比戰鬥區長');
  assert.equal(PANEL_INTERVAL % BATTLE_INTERVAL, 0, '不是整數倍會讓更新忽快忽慢');
});

test('面板到期以經過時間判斷，隱藏很久回來也只補一次', () => {
  assert.equal(panelDue(0, 0), false);
  assert.equal(panelDue(PANEL_INTERVAL - 1, 0), false);
  assert.equal(panelDue(PANEL_INTERVAL, 0), true);
  assert.equal(panelDue(600_000, 0), true);
});

test('除了點擊以外的每個動作都立刻重繪面板', () => {
  assert.equal(panelSyncsOn('tap'), false, '點擊不該每次都重建整份清單');
  for (const type of ACTION_TYPES) {
    if (type === 'tap') continue;
    assert.equal(panelSyncsOn(type), true, `${type} 會改動清單內容，必須立刻重繪`);
  }
});

test('面板真的可以被跳過：元件有 memo，傳進去的三個 prop 都穩定', () => {
  // A slower snapshot saves nothing unless React can skip the subtree, which needs all three props
  // to compare equal. An earlier attempt changed only the cadence and measured no difference.
  const content = readFileSync(new URL('../app/game-content.tsx', import.meta.url), 'utf8');
  assert.match(content, /memo\(TT2Panels\)/, '面板沒有被 memo 包起來');
  assert.ok(source.includes('<GameContent s={panelState}'), '面板讀的不是自己的快照');
  assert.ok(source.includes('act={panelAct}'), 'act 不是穩定的參照');
  assert.ok(source.includes('onPrestige={openPrestige}'), 'onPrestige 不是穩定的參照');
  assert.match(source, /const panelAct=useCallback\(/, 'panelAct 沒有用 useCallback');
  assert.match(source, /const openPrestige=useCallback\(/, 'openPrestige 沒有用 useCallback');
});

test('戰鬥迴圈到期才更新面板，玩家動作則立刻更新', () => {
  const tick = source.slice(source.indexOf('const tick=setInterval('), source.indexOf('},BATTLE_INTERVAL);'));
  assert.ok(tick.includes('panelDue(now,panelAt.current)'), '迴圈沒有走面板自己的間隔');
  assert.ok(source.includes('if(panelSyncsOn(a.type))showPanel(action.at)'), '玩家動作沒有立刻更新面板');
  // Coming back to a visible tab redraws both at once rather than waiting for the next due frame.
  assert.ok(source.includes('advance(state.current,now);setS({...state.current});showPanel(now);'), '回到前景沒有補面板');
});
