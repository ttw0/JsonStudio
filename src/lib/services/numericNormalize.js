import { convertToStandardJson } from './jsonToStandard.js';
import { parseBigInt, stringifyBigInt } from '../utils/jsonBigInt.js';

/** @param {string} content */
export function normalizeNumericJson(content) {
  try {
    // Syntax validation only. The rounded native parse result is never used.
    JSON.parse(content);
    return content;
  } catch {
    return convertToStandardJson(content);
  }
}

/** @param {string} content */
export function minifyNumericJson(content) {
  let data;
  try {
    data = parseBigInt(content);
  } catch (error) {
    if (!(error instanceof SyntaxError || error instanceof RangeError)) throw error;
    return convertToStandardJson(content, 0);
  }
  return stringifyBigInt(data);
}
