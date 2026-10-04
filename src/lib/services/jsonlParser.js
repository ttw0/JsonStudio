/**
 * @typedef {'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'} JsonlValueShape
 * @typedef {'valid' | 'invalid'} JsonlRowKind
 * @typedef {{
 *   id: string;
 *   lineNumber: number;
 *   recordNumber: number;
 *   raw: string;
 *   kind: JsonlRowKind;
 *   shape: JsonlValueShape | null;
 *   value: unknown;
 *   searchText: string;
 *   errorMessage?: string;
 *   errorColumn?: number | null;
 * }} JsonlRow
 * @typedef {{
 *   name: string;
 * }} JsonlColumn
 * @typedef {{
 *   lineCount: number;
 *   recordCount: number;
 *   validCount: number;
 *   invalidCount: number;
 *   emptyCount: number;
 * }} JsonlSummary
 * @typedef {{
 *   rows: JsonlRow[];
 *   columns: JsonlColumn[];
 *   summary: JsonlSummary;
 * }} JsonlDocument
 */

import { parseBigInt } from '../utils/jsonBigInt.js';

/**
 * Parse newline-delimited JSON without changing the source text.
 * Blank lines are counted in the summary but omitted from the record list so
 * the table stays focused on actual records. Every returned row keeps its
 * original one-based source line number.
 *
 * @param {string} source
 * @returns {JsonlDocument}
 */
export function parseJsonl(source) {
  const lines = splitJsonlLines(String(source ?? ''));
  /** @type {JsonlRow[]} */
  const rows = [];
  /** @type {Map<string, true>} */
  const columnMeta = new Map();
  let recordNumber = 0;
  let validCount = 0;
  let invalidCount = 0;
  let emptyCount = 0;

  lines.forEach((raw, index) => {
    const lineNumber = index + 1;
    const trimmed = raw.trim();
    if (!trimmed) {
      emptyCount += 1;
      return;
    }

    recordNumber += 1;
    const id = `${lineNumber}:${recordNumber}`;
    try {
      const value = parseBigInt(trimmed);
      const shape = getJsonlValueShape(value);
      const fields = getObjectFields(value);

      for (const field of fields) {
        columnMeta.set(field, true);
      }

      validCount += 1;
      rows.push({
        id,
        lineNumber,
        recordNumber,
        raw,
        kind: 'valid',
        shape,
        value,
        searchText: `${raw}\n${fields.join(' ')}`.toLocaleLowerCase(),
      });
    } catch (error) {
      invalidCount += 1;
      const errorMessage = error instanceof Error ? error.message : 'Invalid JSON';
      rows.push({
        id,
        lineNumber,
        recordNumber,
        raw,
        kind: 'invalid',
        shape: null,
        value: null,
        searchText: `${raw}\n${errorMessage}`.toLocaleLowerCase(),
        errorMessage,
        errorColumn: getJsonParseErrorColumn(
          errorMessage,
          trimmed,
          raw.length - raw.trimStart().length,
        ),
      });
    }
  });

  const columns = [...columnMeta.keys()].map((name) => ({ name }));

  return {
    rows,
    columns,
    summary: {
      lineCount: lines.length,
      recordCount: recordNumber,
      validCount,
      invalidCount,
      emptyCount,
    },
  };
}

/**
 * Split JSONL into physical lines while treating the final line break as a
 * delimiter rather than an additional empty record.
 * @param {string} source
 * @returns {string[]}
 */
function splitJsonlLines(source) {
  if (!source) return [];
  const lines = source.split(/\r?\n/);
  if (source.endsWith('\n')) lines.pop();
  return lines;
}

/**
 * @param {unknown} value
 * @returns {JsonlValueShape}
 */
export function getJsonlValueShape(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number' || typeof value === 'bigint') return 'number';
  return 'boolean';
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function getObjectFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value);
}

/**
 * @param {string} pathOrName
 */
export function isJsonlFilePath(pathOrName) {
  return /\.(?:jsonl|ndjson)$/i.test(String(pathOrName ?? '').trim());
}

/**
 * @param {string} message
 * @param {string} input
 * @param {number} [columnOffset]
 */
function getJsonParseErrorColumn(message, input, columnOffset = 0) {
  const position = message.match(/position\s+(\d+)/i);
  if (position) return Number(position[1]) + 1 + columnOffset;

  const token = message.match(/Unexpected token ['"](.+?)['"]/i)?.[1];
  if (token) {
    const tokenIndex = input.indexOf(token);
    if (tokenIndex >= 0) return tokenIndex + 1 + columnOffset;
  }

  const column = message.match(/column\s+(\d+)/i);
  if (column) return Number(column[1]) + columnOffset;

  if (/Unexpected end/i.test(message)) return input.length + 1 + columnOffset;
  return null;
}
