import { parseJsonSourceDocument } from './jsonSourceModel.js';
import { stringifyBigInt } from '../utils/jsonBigInt.js';

/**
 * Convert a valid JSONC or JSON5 document into formatted, strict JSON.
 *
 * Object entries are serialized from the source model so duplicate keys remain
 * intact. JSON5 non-finite numbers are represented as null in strict JSON.
 *
 * @param {string} content
 * @param {number} [indent]
 * @returns {string}
 */
export function convertToStandardJson(content, indent = 2) {
  const parsed = parseJsonSourceDocument(content, {
    dialect: 'AUTO',
    retainSourceModel: true,
    buildPointers: false,
  });
  if (!('sourceModel' in parsed)) {
    throw new Error('Cannot build JSON source model');
  }

  return serializeSourceNode(parsed.sourceModel, indent);
}

/**
 * @param {import('./jsonSourceModel.js').JsonSourceNode} root
 * @param {number} indent
 * @returns {string}
 */
function serializeSourceNode(root, indent) {
  /** @type {Array<string | { node: import('./jsonSourceModel.js').JsonSourceNode; depth: number }>} */
  const pending = [{ node: root, depth: 0 }];
  const chunks = [];
  const pretty = indent > 0;
  while (pending.length) {
    const task = pending.pop();
    if (typeof task === 'string') {
      chunks.push(task);
      continue;
    }
    if (!task) break;
    const { node, depth } = task;
    if (node.kind === 'object' || node.kind === 'array') {
      const object = node.kind === 'object';
      const items = object ? node.entries : node.items;
      const [open, close] = object ? ['{', '}'] : ['[', ']'];
      if (!items.length) {
        chunks.push(open + close);
        continue;
      }
      const innerIndent = pretty ? ' '.repeat(indent * (depth + 1)) : '';
      const outerIndent = pretty ? ' '.repeat(indent * depth) : '';
      chunks.push(open + (pretty ? '\n' : ''));
      pending.push((pretty ? '\n' + outerIndent : '') + close);
      for (let index = items.length - 1; index >= 0; index -= 1) {
        if (index < items.length - 1) pending.push(pretty ? ',\n' : ',');
        if (node.kind === 'object') {
          const entry = node.entries[index];
          pending.push({ node: entry.value, depth: depth + 1 });
          pending.push(innerIndent + JSON.stringify(entry.key) + (pretty ? ': ' : ':'));
        } else {
          pending.push({ node: node.items[index], depth: depth + 1 });
          if (pretty) pending.push(innerIndent);
        }
      }
    } else {
      chunks.push(node.kind === 'number' && typeof node.value === 'number' && !Number.isFinite(node.value)
        ? 'null' : stringifyBigInt(node.value));
    }
  }
  return chunks.join('');
}
