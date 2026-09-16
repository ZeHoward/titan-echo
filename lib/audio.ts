// The game's sounds, written down as data rather than as calls.
//
// There is no audio file in this project and there will not be one: the package's audio is not ours
// to ship, so every cue here is synthesised in the browser from these numbers. Keeping them as data
// means the set can be checked without a browser — that a cue exists, what channel it belongs to,
// how loud it ends up after the mixer — and it keeps the WebAudio glue down to one small player.
//
// A cue is a glide through `notes`, `step` seconds per note, on one oscillator. Two notes make a
// fall or a rise; more make a short phrase. `gain` is the cue's own level before the mixer.

export type Channel = 'effects' | 'music';
export type Wave = 'sine' | 'triangle' | 'square' | 'sawtooth';
export type Cue = {
  label: string;
  channel: Channel;
  wave: Wave;
  notes: number[];
  step: number;
  gain: number;
  loop?: boolean;
};

export const CUES = {
  tap: { label: '點擊', channel: 'effects', wave: 'triangle', notes: [280, 80], step: 0.06, gain: 0.5 },
  crit: { label: '暴擊', channel: 'effects', wave: 'triangle', notes: [720, 300, 110], step: 0.05, gain: 0.7 },
  skill: { label: '施放技能', channel: 'effects', wave: 'sawtooth', notes: [180, 420, 620], step: 0.07, gain: 0.5 },
  upgrade: { label: '升級與購買', channel: 'effects', wave: 'sine', notes: [660, 880], step: 0.07, gain: 0.45 },
  drop: { label: '掉落與妖精', channel: 'effects', wave: 'sine', notes: [880, 1320, 1760], step: 0.05, gain: 0.4 },
  boss: { label: '頭目出現', channel: 'effects', wave: 'sawtooth', notes: [150, 90, 60], step: 0.12, gain: 0.55 },
  victory: { label: '頭目擊破', channel: 'effects', wave: 'sine', notes: [523, 659, 784, 1047], step: 0.08, gain: 0.5 },
  prestige: { label: '蛻變', channel: 'effects', wave: 'sine', notes: [330, 494, 659, 988, 1319], step: 0.13, gain: 0.55 },
  // A slow pentatonic wander, low and soft, meant to sit under the battle rather than be listened to.
  ambient: {
    label: '背景音樂', channel: 'music', wave: 'sine', step: 1.6, gain: 0.22, loop: true,
    notes: [220, 294, 330, 294, 262, 220, 196, 220, 262, 330, 392, 330],
  },
} as const satisfies Record<string, Cue>;

export type CueName = keyof typeof CUES;
export const CUE_NAMES = Object.keys(CUES) as CueName[];

export type AudioSettings = { master: number; effects: number; music: number };
export const AUDIO_DEFAULTS: AudioSettings = { master: 0.7, effects: 0, music: 0 };
export const AUDIO_STORAGE_KEY = 'titan-echo-audio';

const clamp = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/**
 * Reads whatever is in storage into a usable setting.
 *
 * Sound used to be one boolean that was never saved, so a stored `true` becomes a normal effects
 * level rather than silence; anything unreadable falls back to the defaults, which start muted
 * because a page that makes noise before it is asked to is worse than one that stays quiet.
 */
export function normaliseAudio(raw: unknown): AudioSettings {
  if (typeof raw === 'boolean') return { ...AUDIO_DEFAULTS, effects: raw ? 0.6 : 0 };
  if (!raw || typeof raw !== 'object') return { ...AUDIO_DEFAULTS };
  const source = raw as Partial<Record<keyof AudioSettings, unknown>>;
  const read = (key: keyof AudioSettings) =>
    typeof source[key] === 'number' ? clamp(source[key] as number) : AUDIO_DEFAULTS[key];
  return { master: read('master'), effects: read('effects'), music: read('music') };
}

/** What a cue actually comes out at, after its own level and the two faders it passes through. */
export function cueGain(name: CueName, settings: AudioSettings) {
  const cue = CUES[name];
  return clamp(settings.master) * clamp(settings[cue.channel]) * cue.gain;
}

export function isAudible(name: CueName, settings: AudioSettings) {
  return cueGain(name, settings) > 0;
}

/** How long one pass of a cue lasts, in seconds. */
export function cueDuration(name: CueName) {
  const cue = CUES[name];
  return cue.notes.length * cue.step;
}
