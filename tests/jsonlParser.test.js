import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isJsonlFilePath,
  parseJsonl,
} from '../src/lib/services/jsonlParser.js';

test('large integer JSONL values retain numeric shape and exact digits', () => {
  const result = parseJsonl('123456789012345678901234567890\n');
  assert.equal(result.rows[0].shape, 'number');
  assert.equal(result.rows[0].value, 123456789012345678901234567890n);
});

test('parses JSONL records while preserving physical source line numbers', () => {
  const result = parseJsonl([
    '{"id":1,"name":"Alice"}',
    '',
    '{"id":2,"active":true}',
    '42',
  ].join('\n'));

  assert.equal(result.summary.lineCount, 4);
  assert.equal(result.summary.recordCount, 3);
  assert.equal(result.summary.validCount, 3);
  assert.equal(result.summary.emptyCount, 1);
  assert.deepEqual(result.rows.map((row) => row.lineNumber), [1, 3, 4]);
  assert.deepEqual(result.columns.map((column) => column.name), ['id', 'name', 'active']);
  assert.equal(result.rows[1].value.active, true);
  assert.equal(result.rows[2].shape, 'number');
});

test('keeps invalid JSONL rows visible with an actionable parse position', () => {
  const result = parseJsonl('{"id":1}\n{"id":}\n{"id":3}');
  const invalid = result.rows[1];

  assert.equal(result.summary.invalidCount, 1);
  assert.equal(invalid.kind, 'invalid');
  assert.equal(invalid.lineNumber, 2);
  assert.equal(invalid.raw, '{"id":}');
  assert.match(invalid.errorMessage, /Unexpected/);
  assert.equal(typeof invalid.errorColumn, 'number');
  assert.equal(result.rows[2].shape, 'object');
});

test('does not count a terminal line break as an empty JSONL record', () => {
  const result = parseJsonl('{"id":1}\n');

  assert.equal(result.summary.lineCount, 1);
  assert.equal(result.summary.recordCount, 1);
  assert.equal(result.summary.emptyCount, 0);
});

test('parses BOM-prefixed CRLF data without changing the source row', () => {
  const source = '\uFEFF{"id":1}\r\n{"id":2}\r\n';
  const result = parseJsonl(source);

  assert.equal(result.summary.lineCount, 2);
  assert.equal(result.summary.recordCount, 2);
  assert.equal(result.rows[0].raw, '\uFEFF{"id":1}');
  assert.deepEqual(result.rows.map((row) => row.value.id), [1, 2]);
});

test('reports invalid JSON columns relative to the source line', () => {
  const result = parseJsonl('  {"id":}\n');

  assert.equal(result.rows[0].errorColumn, 9);
});

test('recognizes JSONL and NDJSON file names case-insensitively', () => {
  assert.equal(isJsonlFilePath('/tmp/events.JSONL'), true);
  assert.equal(isJsonlFilePath('events.ndjson'), true);
  assert.equal(isJsonlFilePath('events.json'), false);
});
