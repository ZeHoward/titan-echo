// Gold, monster health and recorded hits are stored as a significand/exponent pair. Tests write
// plain numbers and read them back as plain numbers; these two helpers are the whole conversion.
import { fromNumber, isBig, toNumber } from '../lib/big-number.ts';

/** A plain number in the form the engine stores. */
export const B = value => fromNumber(value);

/** Whatever form a value arrived in, read as a plain number. */
export const N = value => (isBig(value) ? toNumber(value) : value);
