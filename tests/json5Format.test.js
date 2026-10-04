import test from 'node:test';
import assert from 'node:assert/strict';
import { formatJson5, formatJsonText } from '../src/lib/services/json5Format.js';
import { parseBigInt } from '../src/lib/utils/jsonBigInt.js';

test('formats JSON5 without converting it to strict JSON syntax', async () => {
  const formatted = await formatJson5(
    "{ // user\n userId: 123, name: 'Alice', ok: true, roles: ['admin',], }",
    2,
  );

  assert.match(formatted, /\/\/ user/);
  assert.match(formatted, /userId: 123/);
  assert.match(formatted, /name: "Alice"/);
  assert.match(formatted, /roles: \["admin"\]/);
  assert.doesNotMatch(formatted, /"userId"/);
});

test('formats standard JSON without removing duplicate object keys', async () => {
  const formatted = await formatJsonText('{"meta":{"count":1},"meta":{"count":2}}', 2);

  assert.equal(formatted.match(/"meta"/g)?.length, 2);
  assert.match(formatted, /"count": 1/);
  assert.match(formatted, /"count": 2/);
});

test('formatting preserves unsafe and 400-digit integers without quotes', async () => {
  const digits = '9'.repeat(400);
  const source = `{"id":9007199254740993,"huge":${digits},"id":9007199254740995}`;
  const formatted = await formatJsonText(source);
  assert.match(formatted, /"id": 9007199254740993/);
  assert.match(formatted, /"id": 9007199254740995/);
  assert.equal(parseBigInt(formatted).huge, BigInt(digits));
  assert.doesNotMatch(formatted, /"huge": "/);
});

test('formatting deeply nested JSON preserves numbers without overflowing the stack', async () => {
  const source = '['.repeat(3000) + '9007199254740993' + ']'.repeat(3000);
  const formatted = await formatJsonText(source, 2);
  assert.equal(formatted.replace(/\s/g, ''), source);
});
