import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTION_TYPES } from '../lib/content.ts';
import { AUDIO_DEFAULTS, CUES, CUE_NAMES, cueDuration, cueGain, isAudible, normaliseAudio } from '../lib/audio.ts';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');

test('每個音效都是可播放的描述：波形、音高、長度、音量都合理', () => {
  assert.ok(CUE_NAMES.length >= 9, `只有 ${CUE_NAMES.length} 個音效`);
  for (const name of CUE_NAMES) {
    const cue = CUES[name];
    assert.ok(cue.label, `${name} 沒有名稱`);
    assert.ok(['effects', 'music'].includes(cue.channel), `${name} 的聲道是 ${cue.channel}`);
    assert.ok(['sine', 'triangle', 'square', 'sawtooth'].includes(cue.wave), `${name} 的波形是 ${cue.wave}`);
    assert.ok(cue.notes.length >= 2, `${name} 只有 ${cue.notes.length} 個音`);
    // An exponential ramp cannot pass through zero, and anything outside hearing is wasted work.
    for (const note of cue.notes) assert.ok(note >= 20 && note <= 12000, `${name} 有 ${note}Hz 的音`);
    assert.ok(cue.step > 0 && cue.step <= 2, `${name} 每音 ${cue.step} 秒`);
    assert.ok(cue.gain > 0 && cue.gain <= 1, `${name} 的音量是 ${cue.gain}`);
    assert.ok(cueDuration(name) === cue.notes.length * cue.step);
  }
});

test('戰鬥音效要短到不會蓋住下一次點擊，背景音樂才可以長', () => {
  for (const name of CUE_NAMES) {
    if (CUES[name].channel === 'music') continue;
    assert.ok(cueDuration(name) <= 0.7, `${name} 長 ${cueDuration(name)} 秒`);
  }
  assert.equal(CUES.ambient.channel, 'music');
  assert.equal(CUES.ambient.loop, true);
});

test('驗收清單上的每一種聲音都有對應的音效', () => {
  // The roadmap line for V06 names these; a cue may be renamed but not quietly dropped.
  for (const name of ['tap', 'skill', 'drop', 'upgrade', 'ambient']) {
    assert.ok(CUE_NAMES.includes(name), `缺少 ${name}`);
  }
});

test('音量是相乘的：任一段為零就聽不到', () => {
  const full = { master: 1, effects: 1, music: 1 };
  assert.equal(cueGain('tap', full), CUES.tap.gain);
  assert.equal(cueGain('tap', { ...full, master: 0 }), 0);
  assert.equal(cueGain('tap', { ...full, effects: 0 }), 0);
  // The music fader must not silence an effect, nor the other way round.
  assert.ok(cueGain('tap', { ...full, music: 0 }) > 0);
  assert.equal(cueGain('ambient', { ...full, music: 0 }), 0);
  assert.ok(cueGain('ambient', { ...full, effects: 0 }) > 0);
  assert.equal(cueGain('tap', { master: 0.5, effects: 0.5, music: 1 }), CUES.tap.gain * 0.25);
  assert.equal(isAudible('tap', { master: 1, effects: 0, music: 1 }), false);
});

test('預設是靜音的，網頁不該在沒被要求前就出聲', () => {
  assert.equal(AUDIO_DEFAULTS.effects, 0);
  assert.equal(AUDIO_DEFAULTS.music, 0);
  for (const name of CUE_NAMES) assert.equal(isAudible(name, AUDIO_DEFAULTS), false, `${name} 預設會響`);
});

test('讀不到或讀到壞值時回到預設，舊的開關布林值仍然讀得懂', () => {
  assert.deepEqual(normaliseAudio(null), AUDIO_DEFAULTS);
  assert.deepEqual(normaliseAudio('壞掉的值'), AUDIO_DEFAULTS);
  assert.deepEqual(normaliseAudio({}), AUDIO_DEFAULTS);
  // Sound used to be one boolean that was never saved; a stored true means "I want sound".
  assert.ok(normaliseAudio(true).effects > 0);
  assert.equal(normaliseAudio(false).effects, 0);
  // Out of range, negative, NaN and non-numbers all have to land inside 0–1.
  const messy = normaliseAudio({ master: 5, effects: -2, music: Number.NaN });
  assert.equal(messy.master, 1);
  assert.equal(messy.effects, 0);
  assert.equal(messy.music, 0);
  assert.equal(normaliseAudio({ master: '0.5' }).master, AUDIO_DEFAULTS.master);
  assert.deepEqual(normaliseAudio({ master: 0.3, effects: 0.4, music: 0.5 }), { master: 0.3, effects: 0.4, music: 0.5 });
});

test('接上的動作都指向存在的音效，而且不碰不存在的動作型別', () => {
  const source = read('app/game.tsx');
  const table = source.slice(source.indexOf('const ACTION_CUES'), source.indexOf('};', source.indexOf('const ACTION_CUES')));
  const pairs = [...table.matchAll(/(\w+):'(\w+)'/g)].map(m => [m[1], m[2]]);
  assert.ok(pairs.length >= 8, `只接了 ${pairs.length} 個動作`);
  for (const [action, cue] of pairs) {
    assert.ok(ACTION_TYPES.includes(action), `${action} 不是引擎的動作型別`);
    assert.ok(CUE_NAMES.includes(cue), `${action} 指向不存在的音效 ${cue}`);
  }
  // Taps are not in that table: they are played straight from strike() with the crit split.
  assert.ok(!pairs.some(([action]) => action === 'tap'), 'tap 不該在動作表裡');
  assert.ok(source.includes("cue(crit?'crit':'tap')"), '點擊沒有分出暴擊音');
});

test('背景分頁不出聲：戰鬥音效掛在可見時才跑的那段', () => {
  const source = read('app/game.tsx');
  const tick = source.slice(source.indexOf('const tick=setInterval('), source.indexOf('},BATTLE_INTERVAL);'));
  const guard = tick.indexOf('redraws(document.visibilityState)');
  assert.ok(guard >= 0, '迴圈裡沒有可見性判斷');
  assert.ok(tick.indexOf('watchForCues(') > guard, '隱藏分頁仍會播放戰鬥音效');
});

test('每個音效都在素材文件裡有紀錄', () => {
  // V06 asks for a source and a release note per asset; these are synthesised, so the record is
  // the cue's own numbers being written down rather than a file.
  const assets = read('ASSETS.md');
  for (const name of CUE_NAMES) {
    assert.ok(assets.includes(name), `ASSETS.md 沒有記錄 ${name}`);
    assert.ok(assets.includes(CUES[name].label), `ASSETS.md 沒有記錄 ${CUES[name].label}`);
  }
});
