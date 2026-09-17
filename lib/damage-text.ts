// Which damage numbers the battle screen is allowed to draw.
//
// The original does not treat this as one switch. MonsterModel.CanShowDamageText is a jump table
// over the 41 named damage sources, and every source that can be hidden at all is mapped onto
// exactly one player option — the Sword Master's own hits, the pet's swipe, the heavenly strike and
// the shadow clone each have their own, and seven sources (the helper family, splash, mega coin)
// have none and always show. The mapping is recorded in reference/tt2/8.2.0/damage-text-evidence.json
// and pinned by tests/damage-text.test.mjs.
//
// Only the four sources this project actually deals damage from appear here. The remaining options
// (clan ship, dagger, gold gun, special attack) are left out rather than shown as dead switches,
// because the builds behind them are not implemented: a toggle for a number that never appears
// would claim more than the game does.

/** One option, named after the native OptionsController field it mirrors. */
export type DamageTextOption = {
  /** The key stored in this project's settings. */
  key: 'swordMaster' | 'pet' | 'heavenlyStrike' | 'shadowClone';
  /** The `<name>Off` boolean in the original's OptionsController. */
  nativeField: string;
  label: string;
  /** The float kind this option hides, as used by the battle screen. */
  kinds: string[];
  /** The native DamageType members the original's switch routes to this option. */
  damageTypes: string[];
};

export const DAMAGE_TEXT_OPTIONS: DamageTextOption[] = [
  {
    key: 'swordMaster', nativeField: 'swordMasterDamageTextOff', label: '劍術大師傷害數字',
    kinds: ['tap', 'crit'],
    damageTypes: ['Tap', 'TapCrit', 'TapSpecialCrit', 'ActiveSkillFireGolem', 'ActiveSkillFireGolemCrit'],
  },
  {
    key: 'pet', nativeField: 'petDamageTextOff', label: '寵物傷害數字',
    kinds: ['pet'],
    damageTypes: ['Pet', 'PetCrit', 'PetBurst', 'PetBurstCrit', 'PetZip', 'DualZip', 'DualBurst'],
  },
  {
    key: 'heavenlyStrike', nativeField: 'heavenlyStrikeDamageTextOff', label: '天堂聖擊傷害數字',
    kinds: ['heavenly'],
    damageTypes: ['ActiveSkillHeavenlyStrike', 'ActiveSkillHeavenlyStrikeCrit', 'TwilightFairy'],
  },
  {
    key: 'shadowClone', nativeField: 'shadowCloneDamageTextOff', label: '影分身傷害數字',
    kinds: ['clone'],
    damageTypes: ['ActiveSkillShadowClone', 'ActiveSkillShadowCloneCrit'],
  },
];

export type DamageTextKey = DamageTextOption['key'];
export type DamageTextSettings = Record<DamageTextKey, boolean>;

/** Everything shown, matching the original: the saved flags are `Off` flags, so the default is on. */
export const DAMAGE_TEXT_DEFAULTS: DamageTextSettings =
  Object.fromEntries(DAMAGE_TEXT_OPTIONS.map(option => [option.key, true])) as DamageTextSettings;

export const DAMAGE_TEXT_STORAGE_KEY = 'titan-echo-damage-text';

/** Reads whatever is in storage into a usable setting; anything unreadable shows the number. */
export function normaliseDamageText(raw: unknown): DamageTextSettings {
  if (!raw || typeof raw !== 'object') return { ...DAMAGE_TEXT_DEFAULTS };
  const source = raw as Partial<Record<DamageTextKey, unknown>>;
  return Object.fromEntries(DAMAGE_TEXT_OPTIONS.map(option =>
    [option.key, typeof source[option.key] === 'boolean' ? source[option.key] : true])) as DamageTextSettings;
}

const OPTION_BY_KIND = new Map(DAMAGE_TEXT_OPTIONS.flatMap(option =>
  option.kinds.map(kind => [kind, option.key] as const)));

/** Whether a float of this kind may be drawn. Kinds no option covers are always drawn. */
export function showsDamageText(settings: DamageTextSettings, kind: string) {
  const key = OPTION_BY_KIND.get(kind);
  return key === undefined ? true : settings[key];
}
