// A magnitude that outgrows a JavaScript number, stored the way the native client stores one:
// a significand and a separate exponent (see reference/tt2/8.2.0/native-number-type.json).
// Nothing in the engine uses this yet; adopting it changes the saved number format and needs
// its own migration. This module only provides the arithmetic and its tests.

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
