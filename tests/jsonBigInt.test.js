import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBigInt, stringifyBigInt, isValidJson } from '../src/lib/utils/jsonBigInt.js';

test('preserves large integer values while keeping safe integers as numbers', () => {
  const parsed = parseBigInt('{"id":123456789012345678901234567890,"safe":9007199254740991}');
  assert.equal(parsed.id, 123456789012345678901234567890n);
  assert.equal(parsed.safe, Number.MAX_SAFE_INTEGER);
  assert.equal(stringifyBigInt(parsed), '{"id":123456789012345678901234567890,"safe":9007199254740991}');
  assert.equal(Object.is(parseBigInt('-0'), -0), true);
});

test('accepts valid long decimals and exponent notation', () => {
  const source = '{"decimal":1.234567890123456789,"exponent":1.234567890123456e20}';
  assert.deepEqual(parseBigInt(source), {
    decimal: JSON.parse(source).decimal,
    exponent: BigInt('123456789012345600000'),
  });
  assert.equal(isValidJson(source), true);
});

test('returns normal JSON objects while safely preserving sensitive keys', () => {
  const source = '{"constructor":1,"__proto__":{"polluted":true},"nested":{"ok":true}}';
  const parsed = parseBigInt(source);
  assert.deepEqual(parsed, JSON.parse(source));
  assert.equal(Object.hasOwn(parsed, '__proto__'), true);
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
  assert.equal({}.polluted, undefined);
});

test('retains native syntax errors and source positions', () => {
  let nativeError;
  try { JSON.parse('{"id":}'); } catch (error) { nativeError = error; }
  assert.throws(() => parseBigInt('{"id":}'), error => {
    assert.equal(error instanceof SyntaxError, true);
    assert.equal(error.message, nativeError.message);
    return true;
  });
});

test('rejects nonstandard leading zeros and accepts valid large-number syntax', () => {
  assert.throws(() => parseBigInt('{"id":01}'), SyntaxError);
  assert.equal(isValidJson('{"id":01}'), false);
  assert.equal(isValidJson(`{"id":${'9'.repeat(400)}}`), true);
});

test('extreme exponents cannot silently underflow to zero or expand without a limit', () => {
  assert.throws(() => parseBigInt('1e-100000000'), /precision/);
  assert.throws(() => parseBigInt('1e100001'), /too large/);
  assert.equal(parseBigInt('0e-100000000'), 0);
});
