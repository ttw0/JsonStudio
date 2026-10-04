import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSchema, validateWithSchema } from '../src/lib/services/schema.ts';

test('generated integer schemas accept their original large-integer JSON', () => {
  const source = '{"id":9007199254740993}';
  const schema = generateSchema(source);
  assert.equal(JSON.parse(schema).properties.id.type, 'integer');
  assert.deepEqual(validateWithSchema(source, schema), { valid: true, errors: [] });
});

test('Schema validation continues to reject incorrect scalar types', () => {
  const schema = generateSchema('{"id":1}');
  assert.equal(validateWithSchema('{"id":"1"}', schema).valid, false);
});

test('Schema inference preserves prototype-sensitive fields when merging arrays', () => {
  const source = '[{"__proto__":1,"constructor":2},{"__proto__":3,"constructor":4}]';
  const schema = JSON.parse(generateSchema(source));
  assert.deepEqual(schema.items.properties, JSON.parse('{"__proto__":{"type":"integer"},"constructor":{"type":"integer"}}'));
  assert.deepEqual(schema.items.required, ['__proto__', 'constructor']);
});
