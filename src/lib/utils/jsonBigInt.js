/**
 * JSON parser that preserves large integer precision beyond JavaScript's
 * Number.MAX_SAFE_INTEGER (2^53 - 1 = 9007199254740991).
 *
 * Uses a lossless parser and native bigint values for unsafe integers.
 */
import { parse as parseLossless, stringify as stringifyLossless } from 'lossless-json';
import BigNumber from 'bignumber.js';

const MAX_EXPANDED_INTEGER_DIGITS = 100_000;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

/** @param {bigint} value @returns {number | bigint} */
function normalizeInteger(value) {
  return value <= MAX_SAFE_BIGINT && value >= MIN_SAFE_BIGINT
    ? Number(value)
    : value;
}

/** @param {string} raw */
export function parseDecimalLiteral(raw) {
  const decimal = new BigNumber(raw);
  if (!decimal.isFinite() ||
    (decimal.isZero() && /[1-9]/.test(raw.split(/[eE]/, 1)[0]))) {
    throw new RangeError('Numeric value exceeds the supported precision range');
  }
  return decimal;
}

/** Parse a validated JSON/JSON5 numeric token without rounding integers.
 * @param {string} raw
 * @returns {number | bigint}
 */
export function parseNumericLiteral(raw) {
  if (/^[+-]?\d+$/.test(raw)) {
    if (raw.length < 16) return Number(raw);
    return normalizeInteger(BigInt(raw));
  }
  if (/^[+-]?0(?:[xX][0-9a-fA-F]+|[oO][0-7]+|[bB][01]+)$/.test(raw)) {
    const sign = raw[0] === '-' ? -1n : 1n;
    return normalizeInteger(sign * BigInt(raw.replace(/^[+-]/, '')));
  }
  const decimal = parseDecimalLiteral(raw);
  if (decimal.isInteger()) {
    if (decimal.isZero() && decimal.isNegative()) return -0;
    const number = decimal.toNumber();
    if (Number.isSafeInteger(number)) return number;
    if (decimal.e !== null && decimal.e >= MAX_EXPANDED_INTEGER_DIGITS) {
      throw new RangeError('Integer exponent is too large to expand safely');
    }
    return normalizeInteger(BigInt(decimal.toFixed(0)));
  }
  const number = decimal.toNumber();
  if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER || Number.isInteger(number)) {
    throw new RangeError('Non-integer numeric value cannot be represented without losing precision');
  }
  return number;
}

/** @param {number | bigint} value */
export function toDecimal(value) {
  return new BigNumber(value.toString());
}

/** @param {number | bigint} left @param {number | bigint} right */
export function compareNumericValues(left, right) {
  return toDecimal(left).comparedTo(toDecimal(right)) ?? 0;
}

/** @param {unknown} value @returns {value is number | bigint} */
export function isJsonNumber(value) {
  return typeof value === 'bigint' || (typeof value === 'number' && Number.isFinite(value));
}

/**
 * Parse JSON string with large integer support
 * @param {string} text - JSON string to parse
 * @param {(raw: string) => unknown} [parseNumber]
 * @returns {any} Parsed JSON with BigInt for large integers
 */
export function parseBigInt(text, parseNumber = parseNumericLiteral) {
  try {
    return parseLossless(text, (_key, value) => {
      if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === null) {
        Object.setPrototypeOf(value, Object.prototype);
      }
      return value;
    }, {
      parseNumber,
      onDuplicateKey: ({ newValue }) => newValue,
    });
  } catch (error) {
    if (error instanceof SyntaxError) JSON.parse(text);
    throw error;
  }
}

/**
 * Stringify JSON with BigInt support
 * @param {any} value - Value to stringify
 * @param {((key: string, value: any) => any) | Array<string | number> | null} [replacer]
 * @param {number | string} [space] - Indentation
 * @returns {string} JSON string
 */
export function stringifyBigInt(value, replacer = null, space) {
  const content = stringifyLossless(value, replacer, space, [{
    test: BigNumber.isBigNumber,
    stringify: (number) => {
      const decimal = /** @type {BigNumber} */ (number);
      if (!decimal.isFinite()) throw new RangeError('Cannot serialize a non-finite precise number');
      return decimal.toString();
    },
  }]);
  if (content === undefined) throw new TypeError('Value cannot be serialized as JSON');
  return content;
}

/**
 * Validate syntax without using the parsed numeric values.
 * @param {string} text - Text to validate
 * @returns {boolean} True if valid JSON
 */
export function isValidJson(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
