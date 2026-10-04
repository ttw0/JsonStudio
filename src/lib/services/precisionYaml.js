import { parseDocument, stringify, visit } from 'yaml';
import { parseBigInt, parseNumericLiteral, stringifyBigInt } from '../utils/jsonBigInt.js';

/** @param {string} content */
export function jsonToYamlPrecise(content) {
  return stringify(parseBigInt(content), { lineWidth: 0 });
}

/** @param {string} content */
export function yamlToJsonPrecise(content) {
  const document = parseDocument(content, { intAsBigInt: true, stringKeys: true });
  if (document.errors.length) throw document.errors[0];
  visit(document, {
    Scalar(_key, node) {
      if ((typeof node.value === 'number' || typeof node.value === 'bigint') &&
        node.type === 'PLAIN' && node.source) {
        node.value = parseNumericLiteral(node.source);
      }
    },
  });
  return stringifyBigInt(document.toJS(), null, 2);
}
