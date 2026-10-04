import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import BigNumber from 'bignumber.js';
import { isJsonNumber, parseBigInt, parseDecimalLiteral, stringifyBigInt, toDecimal } from '../utils/jsonBigInt.js';

const PREFIX = 'x-jsonstudio-precise-';
const NUMERIC = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'];
const SINGLE = new Set(['items', 'additionalItems', 'additionalProperties', 'contains', 'not', 'if', 'then', 'else', 'propertyNames']);
const MAPS = new Set(['properties', 'patternProperties', 'definitions', '$defs', 'dependentSchemas']);
const ARRAYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const COUNTS = new Set(['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties', 'minContains', 'maxContains']);
/** @type {Record<string, [string, string]>} */
const INTEGER_FORMATS = {
  int32: ['-2147483648', '2147483647'],
  int64: ['-9223372036854775808', '9223372036854775807'],
};

/** Preserve exact enum identities when AJV checks metadata uniqueness.
 * @param {any} value @returns {any}
 */
function enumIdentity(value) {
  if (BigNumber.isBigNumber(value)) return ['number', value.toString()];
  if (Array.isArray(value)) return ['array', value.map(enumIdentity)];
  if (value !== null && typeof value === 'object') {
    return ['object', Object.keys(value).sort().map(key => [key, enumIdentity(value[key])])];
  }
  return [typeof value, value];
}

/** @param {any} value @returns {any} */
function metadataValue(value) {
  if (BigNumber.isBigNumber(value)) {
    const number = value.toNumber();
    if (Number.isFinite(number) && number !== 0) return number;
    return value.isZero() ? 0 : value.isNegative() ? -Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
  }
  if (Array.isArray(value)) return value.map(metadataValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      key === 'enum' && Array.isArray(item)
        ? item.map(value => JSON.stringify(enumIdentity(value)))
        : metadataValue(item),
    ]));
  }
  return value;
}

/** @param {any} schema @returns {any} */
function prepare(schema) {
  if (typeof schema === 'boolean') return schema;
  const result = Object.create(null);
  const types = /** @type {string[]} */ (Array.isArray(schema.type) ? schema.type : [schema.type]);
  const hasNumericType = types.some(type => type === 'integer' || type === 'number');
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema') continue;
    if (key.startsWith(PREFIX)) throw new Error('Schema uses a reserved precision keyword');
    if (key === 'type' && hasNumericType) {
      if (schema.nullable === false && types.includes('null')) {
        throw new Error('Schema nullable is false but type includes null');
      }
      result[PREFIX + key] = schema.nullable === true ? [...types, 'null'] : value;
    } else if (key === 'nullable' && hasNumericType) {
      continue;
    } else if (key === 'format' && typeof value === 'string' && Object.hasOwn(INTEGER_FORMATS, value)) {
      result[PREFIX + key] = value;
    } else if (NUMERIC.includes(key)) {
      result[PREFIX + key] = String(value);
    } else if (key === 'const' || key === 'enum') {
      result[PREFIX + key] = stringifyBigInt(value);
    } else if (MAPS.has(key) && value && typeof value === 'object') {
      result[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, prepare(child)]));
    } else if (key === 'dependencies' && value && typeof value === 'object') {
      result[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [
        name, Array.isArray(child) ? child : prepare(child),
      ]));
    } else if (ARRAYS.has(key) && Array.isArray(value)) {
      result[key] = value.map(prepare);
    } else if (SINGLE.has(key) && value !== null && typeof value === 'object') {
      result[key] = Array.isArray(value) ? value.map(prepare) : prepare(value);
    } else {
      if (COUNTS.has(key) && BigNumber.isBigNumber(value) &&
        (!value.isInteger() || value.lt(0) || value.gt(Number.MAX_SAFE_INTEGER))) {
        throw new Error(`Schema keyword "${key}" must be a non-negative safe integer count`);
      }
      result[key] = metadataValue(value);
    }
  }
  return result;
}

/** @param {any} value @param {string} type */
function matchesType(value, type) {
  if (type === 'number') return isJsonNumber(value);
  if (type === 'integer') return typeof value === 'bigint' ||
    (typeof value === 'number' && Number.isInteger(value));
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === type;
}

/** @param {any} left @param {any} right @returns {boolean} */
function equal(left, right) {
  if ((isJsonNumber(left) || BigNumber.isBigNumber(left)) &&
    (isJsonNumber(right) || BigNumber.isBigNumber(right))) {
    return new BigNumber(left.toString()).eq(new BigNumber(right.toString()));
  }
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
}

/** Validate with AJV's structural engine and exact numeric assertion keywords.
 * @param {string} jsonContent
 * @param {string} schemaContent
 */
export function validatePrecisionSchema(jsonContent, schemaContent) {
  const data = parseBigInt(jsonContent);
  const schema = parseBigInt(schemaContent, parseDecimalLiteral);
  const instance = new Ajv({ allErrors: true, verbose: true, strict: false, logger: false });
  addFormats(instance);
  const metadata = metadataValue(schema);
  if (metadata !== null && typeof metadata === 'object') delete metadata.$schema;
  if (!instance.validateSchema(metadata)) {
    throw new Error(instance.errorsText(instance.errors));
  }
  instance.addKeyword({
    keyword: PREFIX + 'type',
    schemaType: ['string', 'array'],
    errors: false,
    compile: type => value => (Array.isArray(type) ? type : [type]).some(item => matchesType(value, item)),
  });
  instance.addKeyword({
    keyword: PREFIX + 'format',
    schemaType: 'string',
    errors: false,
    compile: format => {
      const [minimum, maximum] = INTEGER_FORMATS[format];
      return value => {
        if (!isJsonNumber(value)) return true;
        const number = toDecimal(value);
        return number.isInteger() && number.gte(minimum) && number.lte(maximum);
      };
    },
  });
  for (const keyword of NUMERIC) {
    instance.addKeyword({
      keyword: PREFIX + keyword,
      schemaType: 'string',
      errors: false,
      compile: raw => {
        const bound = new BigNumber(raw);
        return value => {
          if (!isJsonNumber(value)) return true;
          const number = toDecimal(value);
          if (keyword === 'minimum') return number.gte(bound);
          if (keyword === 'maximum') return number.lte(bound);
          if (keyword === 'exclusiveMinimum') return number.gt(bound);
          if (keyword === 'exclusiveMaximum') return number.lt(bound);
          return number.mod(bound).isZero();
        };
      },
    });
  }
  for (const keyword of ['const', 'enum']) {
    instance.addKeyword({
      keyword: PREFIX + keyword,
      schemaType: 'string',
      errors: false,
      compile: raw => {
        const expected = parseBigInt(raw, parseDecimalLiteral);
        return actual => keyword === 'const' ? equal(actual, expected) :
          /** @type {any[]} */ (expected).some(value => equal(actual, value));
      },
    });
  }
  const validate = instance.compile(prepare(schema));
  const valid = Boolean(validate(data));
  return {
    valid,
    errors: (validate.errors ?? []).map(error => {
      const keyword = error.keyword.startsWith(PREFIX) ? error.keyword.slice(PREFIX.length) : error.keyword;
      return {
        path: error.instancePath || '/',
        message: error.keyword.startsWith(PREFIX) ? `must satisfy ${keyword}` : error.message || 'Validation error',
        keyword,
      };
    }),
  };
}
