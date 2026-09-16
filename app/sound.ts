'use client';
import { AUDIO_STORAGE_KEY, CUES, cueDuration, cueGain, normaliseAudio, type AudioSettings, type CueName } from '../lib/audio';

// The only place that touches WebAudio. Everything it decides — which cue, how loud, how long —
// comes from lib/audio.ts, so the rules are testable and this file stays small enough to read.

let context: AudioContext | null = null;
let musicStop: (() => void) | null = null;

function ready() {
  if (typeof window === 'undefined') return null;
  try {
    context ??= new AudioContext();
    // Browsers start the context suspended until a gesture; resuming a running one is a no-op.
    void context.resume();
    return context;
  } catch {
    return null;
  }
}

/** Schedules one pass of a cue and returns when it ends, in context time. */
function schedule(ctx: AudioContext, name: CueName, level: number, at: number) {
  const cue = CUES[name];
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = cue.wave;
  oscillator.frequency.setValueAtTime(cue.notes[0], at);
  cue.notes.forEach((note, index) => {
    if (index > 0) oscillator.frequency.exponentialRampToValueAtTime(note, at + index * cue.step);
  });
  const end = at + cueDuration(name);
  // A short fade in and out: a square edge on a gain node is an audible click.
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(level, at + Math.min(0.02, cue.step / 2));
  gain.gain.setValueAtTime(level, Math.max(at, end - 0.05));
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(at);
  oscillator.stop(end + 0.02);
  return end;
}

export function playCue(name: CueName, settings: AudioSettings) {
  const level = cueGain(name, settings);
  if (level <= 0) return;
  const ctx = ready();
  if (!ctx) return;
  try {
    schedule(ctx, name, level, ctx.currentTime);
  } catch {
    // A refused or closed context must never interrupt the game.
  }
}

/**
 * Starts or stops the background loop to match the settings.
 *
 * The loop is scheduled a few notes ahead and re-armed by a timer rather than by an ended event, so
 * a suspended tab does not leave a note hanging and a volume change takes effect on the next note.
 */
export function syncMusic(settings: AudioSettings) {
  const level = cueGain('ambient', settings);
  if (level <= 0) {
    musicStop?.();
    musicStop = null;
    return;
  }
  if (musicStop) return;
  const ctx = ready();
  if (!ctx) return;
  const cue = CUES.ambient;
  let index = 0;
  let timer = 0;
  let live = true;
  const pushNote = () => {
    if (!live) return;
    try {
      const note = cue.notes[index % cue.notes.length];
      index += 1;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = cue.wave;
      oscillator.frequency.setValueAtTime(note, ctx.currentTime);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(level, ctx.currentTime + cue.step * 0.4);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + cue.step);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + cue.step + 0.05);
    } catch {
      live = false;
      return;
    }
    timer = window.setTimeout(pushNote, cue.step * 1000);
  };
  pushNote();
  musicStop = () => { live = false; window.clearTimeout(timer); };
}

export function readAudioSettings(): AudioSettings {
  try {
    const stored = window.localStorage.getItem(AUDIO_STORAGE_KEY);
    return normaliseAudio(stored === null ? null : JSON.parse(stored));
  } catch {
    return normaliseAudio(null);
  }
}

export function writeAudioSettings(settings: AudioSettings) {
  try {
    window.localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private windows and blocked storage: the setting just does not survive a reload.
  }
}
