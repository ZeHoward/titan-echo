// A magnitude that outgrows a JavaScript number, stored the way the native client stores one:
// a significand and a separate exponent (see reference/tt2/8.2.0/native-number-type.json).
// The engine stores monster health, gold and the last hit this way, so a magnitude keeps growing
// where a double would saturate. Saves written before that carry plain numbers; hydrate converts
// them in place, which is why every entry point accepts either form.

/** Normalised as significand in [1, 10) times 10^exponent, or an exact zero. */
export type Big = { s: number; e: number };

export const ZERO: Big = { s: 0, e: 0 };
export const ONE: Big = { s: 1, e: 0 };

const isZero = (a: Big) => a.s === 0;

/** Bring a raw pair into the normalised form; a non-finite input is not representable. */
export function normalise(s: number, e: number): Big {
  if (!Number.isFinite(s) || !Number.isFinite(e)) throw Error('大數值必須是有限值');
  if (s === 0) return { ...ZERO };
  const sign = s < 0 ? -1 : 1;
  const magnitude = Math.abs(s);
  const shift = Math.floor(Math.log10(magnitude));
  const scaled = magnitude / 10 ** shift;
  // log10 rounding can leave the significand a hair outside [1, 10); nudge it back.
  const [value, carry] = scaled >= 10 ? [scaled / 10, 1] : scaled < 1 ? [scaled * 10, -1] : [scaled, 0];
  return { s: sign * value, e: e + shift + carry };
}

export function fromNumber(value: number): Big {
  return normalise(value, 0);
}

/** Back to a plain number; magnitudes past the double range saturate instead of returning Infinity. */
export function toNumber(a: Big): number {
  if (isZero(a)) return 0;
  if (a.e > 308) return a.s < 0 ? -Number.MAX_VALUE : Number.MAX_VALUE;
  if (a.e < -323) return 0;
  return a.s * 10 ** a.e;
}

export function add(a: Big, b: Big): Big {
  if (isZero(a)) return { ...b };
  if (isZero(b)) return { ...a };
  const [big, small] = a.e >= b.e ? [a, b] : [b, a];
  const gap = big.e - small.e;
  // Beyond the precision of a double the smaller term cannot change the result.
  if (gap > 17) return { ...big };
  return normalise(big.s + small.s / 10 ** gap, big.e);
}

export function negate(a: Big): Big {
  return isZero(a) ? { ...ZERO } : { s: -a.s, e: a.e };
}

export function subtract(a: Big, b: Big): Big {
  return add(a, negate(b));
}

export function multiply(a: Big, b: Big): Big {
  if (isZero(a) || isZero(b)) return { ...ZERO };
  return normalise(a.s * b.s, a.e + b.e);
}

export function divide(a: Big, b: Big): Big {
  if (isZero(b)) throw Error('大數值不可除以零');
  if (isZero(a)) return { ...ZERO };
  return normalise(a.s / b.s, a.e - b.e);
}

/** Integer and fractional powers, kept in log space so the exponent never overflows. */
export function power(a: Big, exponent: number): Big {
  if (!Number.isFinite(exponent)) throw Error('指數必須是有限值');
  if (exponent === 0) return { ...ONE };
  if (isZero(a)) return { ...ZERO };
  if (a.s < 0 && !Number.isInteger(exponent)) throw Error('負數不支援非整數次方');
  // Exact while the result fits a double. The log-space form below rounds the last digit or
  // two, which a later ceil() would turn into a whole unit, so it is the fallback, not the rule.
  if (Math.abs(a.e * exponent) < 300) {
    const direct = toNumber(a) ** exponent;
    if (Number.isFinite(direct) && direct !== 0) return fromNumber(direct);
  }
  const sign = a.s < 0 && Math.abs(exponent % 2) === 1 ? -1 : 1;
  const logs = (Math.log10(Math.abs(a.s)) + a.e) * exponent;
  const whole = Math.floor(logs);
  return normalise(sign * 10 ** (logs - whole), whole);
}

export function compare(a: Big, b: Big): number {
  if (isZero(a) && isZero(b)) return 0;
  if (a.s >= 0 !== b.s >= 0) return a.s >= 0 ? 1 : -1;
  if (isZero(a)) return b.s > 0 ? -1 : 1;
  if (isZero(b)) return a.s > 0 ? 1 : -1;
  const sign = a.s > 0 ? 1 : -1;
  if (a.e !== b.e) return (a.e > b.e ? 1 : -1) * sign;
  return a.s === b.s ? 0 : (a.s > b.s ? 1 : -1);
}

/** Round-trip text for storage: keeps the exact pair rather than a lossy decimal string. */
export function toStorage(a: Big): string {
  return isZero(a) ? '0' : `${a.s}e${a.e}`;
}

export function fromStorage(text: string): Big {
  if (text === '0') return { ...ZERO };
  const match = /^(-?\d+(?:\.\d+)?)e(-?\d+)$/.exec(text);
  if (!match) throw Error(`無法解析的大數值：${text}`);
  return normalise(Number(match[1]), Number(match[2]));
}

/** Either form a value can arrive in: a plain number, or a pair a save already holds. */
export type BigLike = number | Big;

export function isBig(value: unknown): value is Big {
  return !!value && typeof value === 'object' && typeof (value as Big).s === 'number'
    && typeof (value as Big).e === 'number';
}

/** Coerce either form to a normalised pair. */
export function big(value: BigLike): Big {
  return isBig(value) ? normalise(value.s, value.e) : fromNumber(value);
}

export function max(a: Big, b: Big): Big {
  return compare(a, b) >= 0 ? { ...a } : { ...b };
}

export function min(a: Big, b: Big): Big {
  return compare(a, b) <= 0 ? { ...a } : { ...b };
}

export function sum(values: Big[]): Big {
  // Largest first, so the running total never drops a term it could still have absorbed.
  return [...values].sort((x, y) => compare(y, x)).reduce(add, { ...ZERO });
}

/** A plain base raised to a plain exponent, without passing through a double in between. */
export function pow(base: number, exponent: number): Big {
  return power(fromNumber(base), exponent);
}

/** Multiply by a plain factor, the common case where only one side is oversized. */
export function scale(a: Big, factor: number): Big {
  return factor === 0 ? { ...ZERO } : multiply(a, fromNumber(factor));
}

/** Negative magnitudes are not a thing the economy holds; floor at zero. */
export function atLeastZero(a: Big): Big {
  return a.s < 0 ? { ...ZERO } : { ...a };
}

/** Round up, but only while the value is small enough for a whole number to mean anything. */
export function ceil(a: Big): Big {
  return a.e >= 15 || a.s === 0 ? { ...a } : fromNumber(Math.ceil(toNumber(a)));
}

/** a / b as a plain number, for ratios that are known to be small. */
export function ratio(a: Big, b: Big): number {
  return isZero(b) ? 0 : toNumber(divide(a, b));
}

/** Parse a decimal or scientific literal exactly, including magnitudes a double cannot hold. */
export function fromText(text: string): Big {
  const match = /^(-?\d+(?:\.\d+)?)[eE]([+-]?\d+)$/.exec(text.trim());
  if (match) return normalise(Number(match[1]), Number(match[2]));
  const value = Number(text);
  if (!Number.isFinite(value)) throw Error(`無法解析的大數值：${text}`);
  return fromNumber(value);
}
