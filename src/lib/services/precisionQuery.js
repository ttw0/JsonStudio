import jmespath from 'jmespath';
import { JSONPath } from 'jsonpath-plus';
import {
  compareNumericValues,
  isJsonNumber,
  parseBigInt,
  parseNumericLiteral,
  stringifyBigInt,
  toDecimal,
} from '../utils/jsonBigInt.js';

/** @param {string} operator @param {any} left @param {any} right */
function arithmetic(operator, left, right) {
  if (!isJsonNumber(left) || !isJsonNumber(right)) {
    if (operator === '+' && (typeof left === 'string' || typeof right === 'string')) return left + right;
    throw new TypeError('Precision-safe arithmetic requires JSON numbers');
  }
  const a = toDecimal(left);
  const b = toDecimal(right);
  const result = operator === '+' ? a.plus(b)
    : operator === '-' ? a.minus(b)
      : operator === '*' ? a.times(b)
        : operator === '/' ? a.div(b)
          : a.mod(b);
  if (operator === '/' && result.isInteger() && !result.times(b).eq(a)) {
    throw new RangeError('Division cannot be represented without losing precision');
  }
  return parseNumericLiteral(result.toString());
}

/** @param {unknown} value */
function toNumber(value) {
  if (isJsonNumber(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    return parseNumericLiteral(value.trim() || '0');
  } catch {
    return null;
  }
}

/** @param {any[]} values @param {boolean} descending */
function ordered(values, descending = false) {
  return [...values].sort((a, b) => {
    const comparison = isJsonNumber(a) && isJsonNumber(b)
      ? compareNumericValues(a, b)
      : a < b ? -1 : a > b ? 1 : 0;
    return descending ? -comparison : comparison;
  });
}

/** @type {Record<string, (args: any[]) => any>} */
const numericFunctions = {
  abs: (args) => parseNumericLiteral(toDecimal(args[0]).abs().toString()),
  ceil: (args) => parseNumericLiteral(toDecimal(args[0]).integerValue(2).toString()),
  floor: (args) => parseNumericLiteral(toDecimal(args[0]).integerValue(3).toString()),
  sum: (args) => /** @type {Array<number | bigint>} */ (args[0])
    .reduce((total, value) => arithmetic('+', total, value), /** @type {number | bigint} */ (0)),
  avg: (args) => args[0].length
    ? arithmetic('/', numericFunctions.sum(args), args[0].length)
    : null,
  min: (args) => ordered(args[0])[0] ?? null,
  max: (args) => ordered(args[0], true)[0] ?? null,
  sort: (args) => ordered(args[0]),
  to_number: (args) => toNumber(args[0]),
  to_string: (args) => typeof args[0] === 'string' ? args[0] : stringifyBigInt(args[0]),
};

/** @param {unknown} data @param {string} query */
export function searchJmesPath(data, query) {
  return jmespath.search(data, query, { parseJSON: parseBigInt, functions: numericFunctions });
}

const mathFunctions = Object.fromEntries(['+', '-', '*', '/', '%'].map((operator, index) => [
  `__jsonstudio_math_${index}`,
  /** @param {any} left @param {any} right */
  (left, right) => arithmetic(operator, left, right),
]));

/** Use JSONPath's existing sandbox, replacing only numeric literals and arithmetic.
 * @param {any} node
 */
function preciseExpression(node) {
  if (!node || typeof node !== 'object') return node;
  if (node.type === 'Literal' && typeof node.value === 'number' && typeof node.raw === 'string') {
    node.value = parseNumericLiteral(node.raw);
    return node;
  }
  for (const [key, child] of Object.entries(node)) {
    if (Array.isArray(child)) node[key] = child.map(preciseExpression);
    else if (child && typeof child === 'object') node[key] = preciseExpression(child);
  }
  if (node.type === 'BinaryExpression' && ['+', '-', '*', '/', '%'].includes(node.operator)) {
    return {
      type: 'CallExpression',
      callee: { type: 'Identifier', name: `__jsonstudio_math_${['+', '-', '*', '/', '%'].indexOf(node.operator)}` },
      arguments: [node.left, node.right],
    };
  }
  return node;
}

const SafeScript = /** @type {any} */ (JSONPath).prototype.safeVm.Script;
class PrecisionScript extends SafeScript {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.ast = preciseExpression(this.ast);
  }

  /** @param {Record<string, unknown>} context */
  runInNewContext(context) {
    return super.runInNewContext({ ...context, ...mathFunctions });
  }
}

const Path = /** @type {any} */ (JSONPath);
class PrecisionJSONPath extends Path {
  /** @param {any} options */
  constructor(options) {
    super(options);
  }

  /** @param {any[]} expression @param {unknown} value @param {any[]} rest */
  _trace(expression, value, ...rest) {
    if (typeof value === 'bigint' && ['@number()', '@integer()'].includes(expression[0])) {
      return super._trace(['@scalar()', ...expression.slice(1)], value, ...rest);
    }
    return super._trace(expression, value, ...rest);
  }
}

/** @param {unknown} data @param {string} query */
export function searchJsonPath(data, query) {
  return new PrecisionJSONPath({
    path: query,
    json: /** @type {any} */ (data),
    resultType: 'pointer',
    wrap: true,
    eval: PrecisionScript,
  });
}
