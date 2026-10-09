import { parseBigInt, stringifyBigInt } from '../utils/jsonBigInt.js';
import { buildJsonTreeModel } from './jsonTreeModel.js';

const MAX_EMBEDDED_JSON_UNWRAP_DEPTH = 3;
const MAX_EXPAND_ALL_PASSES = 8;

/**
 * @typedef {{ lineBreak: string; indentUnit: string; lineIndent?: string }} EmbeddedJsonFormat
 * @typedef {{ type: string; value: unknown; startOffset: number; endOffset: number; children?: EmbeddedJsonNode[] }} EmbeddedJsonNode
 */

/**
 * Detect a string value whose content is itself a JSON object or array, such
 * as `"{\"id\":1}"`. Strings that were escaped more than once are unwrapped
 * until an object or array appears.
 *
 * @param {unknown} value
 * @returns {{ ok: true; value: object } | { ok: false }}
 */
export function parseEmbeddedJsonString(value) {
  let current = value;
  for (let depth = 0; depth < MAX_EMBEDDED_JSON_UNWRAP_DEPTH; depth += 1) {
    if (typeof current !== 'string' || !looksLikeEmbeddedJson(current)) break;
    try {
      current = parseBigInt(current);
    } catch {
      return { ok: false };
    }
    if (current !== null && typeof current === 'object') {
      return { ok: true, value: /** @type {object} */ (current) };
    }
  }
  return { ok: false };
}

/** @param {string} text */
function looksLikeEmbeddedJson(text) {
  const trimmed = text.trim();
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  return (first === '{' && last === '}')
    || (first === '[' && last === ']')
    || (first === '"' && last === '"' && trimmed.length > 2);
}

/**
 * Infer the line break and indentation unit a document already uses. A
 * document without line breaks is treated as minified.
 *
 * @param {string} content
 * @returns {EmbeddedJsonFormat}
 */
export function detectEmbeddedJsonFormat(content) {
  const lineBreak = /\r\n|\n|\r/u.exec(content)?.[0] ?? '';
  const indent = /(?:\r\n|\n|\r)([ \t]+)\S/u.exec(content)?.[1];
  const indentUnit = !indent ? '  ' : indent[0] === '\t' ? '\t' : indent;
  return { lineBreak, indentUnit };
}

/**
 * Serialize an expanded value so it can replace a string literal in place.
 *
 * @param {object} value
 * @param {EmbeddedJsonFormat} format
 */
export function formatEmbeddedJson(value, { lineBreak, indentUnit, lineIndent = '' }) {
  if (!lineBreak) return stringifyBigInt(value);
  return stringifyBigInt(value, null, indentUnit).replace(/\n/gu, `${lineBreak}${lineIndent}`);
}

/**
 * Create a source edit that replaces a JSON string value with the object or
 * array it encodes, indented to match the surrounding document.
 *
 * @param {string} content
 * @param {EmbeddedJsonNode} node
 * @param {EmbeddedJsonFormat} [format]
 */
export function createEmbeddedJsonExpandEdit(content, node, format = detectEmbeddedJsonFormat(content)) {
  if (node.type !== 'string') return { ok: false, error: 'Value is not a string' };
  const parsed = parseEmbeddedJsonString(node.value);
  if (!parsed.ok) return { ok: false, error: 'Value is not a JSON string' };

  const { startOffset: start, endOffset: end } = node;
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) {
    return { ok: false, error: 'Value range not found' };
  }

  const lineIndent = /^[ \t]*/u.exec(content.slice(findLineStart(content, start), start))?.[0] ?? '';
  return {
    ok: true,
    edit: { start, end, text: formatEmbeddedJson(parsed.value, { ...format, lineIndent }) },
  };
}

/**
 * Expand every JSON string value in a document, including JSON strings that
 * only appear after an outer string has been expanded. Edits are applied to
 * the source text, so comments and the rest of the formatting are kept.
 *
 * @param {string} content
 * @returns {{ content: string; count: number }}
 */
export function expandAllEmbeddedJson(content) {
  const format = detectEmbeddedJsonFormat(content);
  let current = content;
  let count = 0;

  for (let pass = 0; pass < MAX_EXPAND_ALL_PASSES; pass += 1) {
    /** @type {{ start: number; end: number; text: string }[]} */
    const edits = [];
    /** @type {EmbeddedJsonNode[]} */
    const pending = [...buildJsonTreeModel(current).nodes];
    while (pending.length > 0) {
      const node = /** @type {EmbeddedJsonNode} */ (pending.pop());
      if (node.children) {
        pending.push(...node.children);
        continue;
      }
      const result = createEmbeddedJsonExpandEdit(current, node, format);
      if (result.ok && result.edit) edits.push(result.edit);
    }
    if (edits.length === 0) break;

    edits.sort((left, right) => right.start - left.start);
    for (const edit of edits) {
      current = current.slice(0, edit.start) + edit.text + current.slice(edit.end);
    }
    count += edits.length;
  }

  return { content: current, count };
}

/**
 * Find the double-quoted string literal under a column of one source line.
 * JSON strings cannot span lines, so the scan never needs neighbouring lines.
 *
 * @param {string} line
 * @param {number} column Zero-based column of the cursor.
 * @returns {{ start: number; end: number; value: string; isKey: boolean } | null}
 */
export function findJsonStringLiteralAt(line, column) {
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (char === '/' && line[index + 1] === '/') return null;
    if (char === '/' && line[index + 1] === '*') {
      const commentEnd = line.indexOf('*/', index + 2);
      if (commentEnd < 0) return null;
      index = commentEnd + 2;
      continue;
    }
    if (char !== '"' && char !== "'") {
      index += 1;
      continue;
    }

    const start = index;
    index += 1;
    while (index < line.length && line[index] !== char) {
      index += line[index] === '\\' ? 2 : 1;
    }
    const end = Math.min(line.length, index + 1);
    index = end;
    if (column < start || column > end) continue;
    if (char !== '"' || end - start < 2 || line[end - 1] !== '"') return null;

    let value;
    try {
      value = JSON.parse(line.slice(start, end));
    } catch {
      return null;
    }
    const isKey = /^\s*:/u.test(line.slice(end));
    return { start, end, value, isKey };
  }
  return null;
}

/** @param {string} content @param {number} offset */
function findLineStart(content, offset) {
  let index = Math.max(0, Math.min(content.length, offset));
  while (index > 0) {
    const previous = content[index - 1];
    if (previous === '\n' || previous === '\r' || previous === ' ' || previous === ' ') {
      break;
    }
    index -= 1;
  }
  return index;
}
