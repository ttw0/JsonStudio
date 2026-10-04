import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWithSchema, generateSchema } from '../src/lib/services/schema.ts';

function valid(value, schema) {
  return validateWithSchema(value, schema).valid;
}

test('integer type accepts large JSON numbers but rejects numeric strings', () => {
  const schema = '{"type":"integer"}';
  assert.equal(valid('9007199254740993', schema), true);
  assert.equal(valid('"9007199254740993"', schema), false);
  assert.equal(valid('0.1', schema), false);
});

test('minimum and maximum distinguish adjacent unsafe integers', () => {
  const schema = '{"type":"integer","minimum":9007199254740993,"maximum":9007199254740993}';
  assert.equal(valid('9007199254740993', schema), true);
  assert.equal(valid('9007199254740992', schema), false);
  assert.equal(valid('9007199254740994', schema), false);
});

test('exclusive bounds and multipleOf are evaluated without floating-point rounding', () => {
  const schema = '{"type":"number","exclusiveMinimum":9007199254740992,"exclusiveMaximum":9007199254740994}';
  assert.equal(valid('9007199254740993', schema), true);
  assert.equal(valid('9007199254740992', schema), false);
  assert.equal(valid('9007199254740994', schema), false);
  assert.equal(valid('9007199254740993', '{"multipleOf":3}'), true);
  assert.equal(valid('9007199254740994', '{"multipleOf":3}'), false);
});

test('fractional numeric bounds remain exact when validating integers', () => {
  assert.equal(valid('10', '{"minimum":10.000000000000000001}'), false);
  assert.equal(valid('11', '{"minimum":10.000000000000000001}'), true);
});

test('const and enum compare nested large values exactly', () => {
  const schema = '{"const":{"id":9007199254740993}}';
  assert.equal(valid('{"id":9007199254740993}', schema), true);
  assert.equal(valid('{"id":9007199254740992}', schema), false);
  assert.equal(valid('9007199254740993', '{"enum":[9007199254740993,9007199254740995]}'), true);
  assert.equal(valid('9007199254740994', '{"enum":[9007199254740993,9007199254740995]}'), false);
});

test('enum metadata distinguishes adjacent unsafe integers and nested values', () => {
  const schema = '{"enum":[9007199254740992,9007199254740993]}';
  assert.equal(valid('9007199254740992', schema), true);
  assert.equal(valid('9007199254740993', schema), true);
  assert.equal(valid('9007199254740994', schema), false);
  const nested = '{"enum":[{"id":9007199254740992},{"id":9007199254740993}]}';
  assert.equal(valid('{"id":9007199254740993}', nested), true);
  const digits = '9'.repeat(400);
  assert.equal(valid(digits, `{"enum":[${digits},${BigInt(digits) - 1n}]}`), true);
});

test('enum metadata still rejects exact duplicates without conflating strings and numbers', () => {
  assert.equal(valid('"9007199254740993"', '{"enum":[9007199254740993,"9007199254740993"]}'), true);
  assert.throws(() => valid('1', '{"enum":[1,1.0]}'), /duplicate/);
  assert.throws(() => valid('null', '{"enum":[]}'));
  assert.throws(() => valid('null', '{"enum":[{"a":1,"b":2},{"b":2,"a":1}]}'), /duplicate/);
});

test('references, compositions, arrays and regular constraints still use AJV', () => {
  const schema = '{"type":"object","properties":{"ids":{"type":"array","items":{"$ref":"#/definitions/id"}},"name":{"type":"string","minLength":2}},"required":["ids","name"],"additionalProperties":false,"definitions":{"id":{"type":"integer","minimum":9007199254740993}}}';
  assert.equal(valid('{"ids":[9007199254740993],"name":"OK"}', schema), true);
  assert.equal(valid('{"ids":[9007199254740992],"name":"OK"}', schema), false);
  assert.equal(valid('{"ids":[9007199254740993],"name":"x"}', schema), false);
  assert.equal(valid('{"ids":[9007199254740993],"name":"OK","extra":true}', schema), false);
  assert.equal(valid('9007199254740993', '{"anyOf":[{"const":9007199254740993},{"type":"null"}]}'), true);
});

test('400-digit values and boolean schemas retain their semantics', () => {
  const number = '9'.repeat(400);
  assert.equal(valid(number, `{"const":${number}}`), true);
  assert.equal(valid(number, generateSchema(number)), true);
  assert.equal(valid(number, 'true'), true);
  assert.equal(valid(number, 'false'), false);
});

test('invalid schemas are rejected and errors expose standard keywords', () => {
  assert.throws(() => valid('1', '{"type":"invalid"}'));
  const result = validateWithSchema('9007199254740992', '{"minimum":9007199254740993}');
  assert.equal(result.errors[0].keyword, 'minimum');
  assert.equal(result.errors[0].path, '/');
});

test('count constraints and extreme numeric bounds cannot be silently rounded', () => {
  for (const key of ['minLength', 'maxItems', 'minProperties']) {
    assert.throws(() => valid('null', `{"${key}":1.00000000000000000001}`), /count/);
    assert.throws(() => valid('null', `{"${key}":9007199254740993}`), /count/);
  }
  assert.throws(() => valid('0', '{"minimum":1e-100000000}'), /precision/);
  assert.throws(() => valid('0', '{"maximum":1e100000000}'), /precision/);
  assert.equal(valid('""', '{"minLength":-0}'), true);
});

test('nullable numeric types and numeric formats retain validation behavior', () => {
  const nullable = '{"type":"integer","nullable":true}';
  assert.equal(valid('9007199254740993', nullable), true);
  assert.equal(valid('null', nullable), true);
  assert.equal(valid('"9007199254740993"', nullable), false);
  assert.throws(() => valid('null', '{"type":["integer","null"],"nullable":false}'), /nullable/);
  assert.equal(valid('9007199254740993', '{"type":"integer","format":"int32"}'), false);
  assert.equal(valid('2147483647', '{"type":"integer","format":"int32"}'), true);
  assert.equal(valid('9223372036854775807', '{"format":"int64"}'), true);
  assert.equal(valid('-9223372036854775808', '{"format":"int64"}'), true);
  assert.equal(valid('9223372036854775808', '{"format":"int64"}'), false);
  assert.equal(valid('-9223372036854775809', '{"format":"int64"}'), false);
  assert.equal(valid('0.5', '{"format":"int64"}'), false);
});
