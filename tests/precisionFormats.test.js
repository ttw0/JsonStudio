import test from 'node:test';
import assert from 'node:assert/strict';
import { jsonToYamlPrecise, yamlToJsonPrecise } from '../src/lib/services/precisionYaml.js';
import { minifyNumericJson, normalizeNumericJson } from '../src/lib/services/numericNormalize.js';
import { generateCode } from '../src/lib/services/codegen.ts';
import { formatProperties, parseProperties, formatMarkdownTable, parseMarkdownTable } from '../src/lib/services/convertExtraFormats.js';
import { parseBigInt } from '../src/lib/utils/jsonBigInt.js';

const SOURCE = '{"id":123456789012345678901234567890,"stringId":"9007199254740993","negative":-9223372036854775809}';

test('YAML round trips preserve large numbers and quoted numeric strings', () => {
  const yaml = jsonToYamlPrecise(SOURCE);
  assert.match(yaml, /123456789012345678901234567890/);
  assert.deepEqual(parseBigInt(yamlToJsonPrecise(yaml)), parseBigInt(SOURCE));
});

test('YAML supports huge integer tokens and integral exponents', () => {
  const digits = '9'.repeat(400);
  assert.equal(parseBigInt(yamlToJsonPrecise(`id: ${digits}`)).id, BigInt(digits));
  assert.equal(parseBigInt(yamlToJsonPrecise('id: 9.007199254740993e15')).id, 9007199254740993n);
  assert.equal(parseBigInt(yamlToJsonPrecise('id: 0x20000000000001')).id, 9007199254740993n);
});

test('text formats keep integer and exponent-shaped strings as strings', () => {
  const data = { id: '9007199254740993', exponent: '9.007199254740993e15', number: 9007199254740993n };
  assert.deepEqual(parseProperties(formatProperties(data)), data);
  assert.deepEqual(parseProperties(formatProperties({ record: data }, { ini: true }), { ini: true }), { record: data });
  assert.deepEqual(parseMarkdownTable(formatMarkdownTable([data])), [data]);
});

test('JSON5 native-command input is normalized losslessly before IPC', () => {
  const content = '{ // IDs\n id: 9007199254740993, hex: 0x20000000000001, huge: 123456789012345678901234567890, }';
  assert.deepEqual(parseBigInt(normalizeNumericJson(content)), {
    id: 9007199254740993n, hex: 9007199254740993n, huge: 123456789012345678901234567890n,
  });
  assert.equal(normalizeNumericJson(SOURCE), SOURCE);
  assert.equal(minifyNumericJson('{id:0x20000000000001, /* precise */ exponent:9.007199254740993e15}'),
    '{"id":9007199254740993,"exponent":9007199254740993}');
  assert.throws(() => minifyNumericJson('{"id":1e100001}'), /too large/);
});

test('minification handles deeply nested JSON with unsafe integers', () => {
  const source = '['.repeat(3000) + '9007199254740993' + ']'.repeat(3000);
  assert.equal(minifyNumericJson(source), source);
});

test('codegen never misclassifies arbitrary integers as floating-point values', async () => {
  const python = await generateCode('{"id":123456789012345678901234567890}', 'python', 'Example');
  assert.match(python, /id: int/);
  assert.doesNotMatch(python, /id: float/);
  const ruby = await generateCode('{"id":123456789012345678901234567890}', 'ruby', 'Example');
  assert.doesNotMatch(ruby, /attribute :id, Types::Double/);
});

test('codegen explicitly rejects targets that cannot safely contain the sample', async () => {
  await assert.rejects(generateCode('{"id":9007199254740993}', 'typescript', 'Example'), /cannot represent/);
  await assert.rejects(generateCode('{"id":123456789012345678901234567890}', 'java', 'Example'), /cannot represent/);
  const java = await generateCode('{"id":9223372036854775807}', 'java', 'Example');
  assert.match(java, /long id/);
});

test('codegen keeps unrelated integer and fractional fields in separate types', async () => {
  const java = await generateCode('{"primary":{"id":9007199254740993},"secondary":{"id":0.5}}', 'java', 'Example');
  assert.match(java, /private long id/);
  assert.match(java, /private double id/);
  for (const language of ['java', 'python', 'ruby', 'protobuf']) {
    await assert.rejects(generateCode('{"records":[{"id":9007199254740993},{"id":0.5}]}', language, 'Example'), /mixed with fractional/);
  }
});
