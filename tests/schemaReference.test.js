import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRemoteSchema, getRemoteSchemaUrl } from '../src/lib/services/schemaReference.js';
import { validateWithSchema } from '../src/lib/services/schema.ts';

test('extracts only remote HTTPS schema references', () => {
  assert.equal(
    getRemoteSchemaUrl('{"$schema":"https://biomejs.dev/schemas/2.5.6/schema.json"}'),
    'https://biomejs.dev/schemas/2.5.6/schema.json',
  );
  assert.equal(getRemoteSchemaUrl('{"$schema":"./schema.json"}'), null);
  assert.equal(getRemoteSchemaUrl('{"$schema":"http://example.com/schema.json"}'), null);
  assert.equal(getRemoteSchemaUrl('{"$schema":"file:///tmp/schema.json"}'), null);
  assert.equal(
    getRemoteSchemaUrl('{"$schema":"  https://example.com/schema.json  "}'),
    'https://example.com/schema.json',
  );
  assert.equal(getRemoteSchemaUrl('{"$schema":"https://user:pass@example.com/schema.json"}'), null);
  assert.equal(getRemoteSchemaUrl('[]'), null);
});

test('fetches and formats a remote JSON Schema', async () => {
  const schema = await fetchRemoteSchema('https://example.com/schema.json', {
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://example.com/schema.json');
      assert.equal(options.headers.Accept, 'application/schema+json, application/json');
      return new Response('{"type":"object"}', { status: 200, statusText: 'OK' });
    },
  });

  assert.equal(schema, '{\n  "type": "object"\n}');
});

test('reports invalid remote schema responses', async () => {
  await assert.rejects(
    fetchRemoteSchema('https://example.com/schema.json', {
      fetchImpl: async () => new Response('Not found', { status: 404, statusText: 'Not Found' }),
    }),
    /404 Not Found/,
  );

  await assert.rejects(
    fetchRemoteSchema('https://example.com/schema.json', {
      fetchImpl: async () => new Response('null', { status: 200 }),
    }),
    /must be a JSON object or boolean/,
  );
});

test('rejects invalid schema URLs before making a request', async () => {
  await assert.rejects(
    fetchRemoteSchema('http://example.com/schema.json', {
      fetchImpl: async () => { throw new Error('request should not run'); },
    }),
    /Only HTTPS schema URLs/,
  );
});

test('rejects schema responses over the size limit', async () => {
  await assert.rejects(
    fetchRemoteSchema('https://example.com/schema.json', {
      fetchImpl: async () => new Response('', {
        status: 200,
        headers: { 'content-length': String(5 * 1024 * 1024 + 1) },
      }),
    }),
    /5 MiB limit/,
  );
});

test('remote schema bounds retain all digits before precision validation', async () => {
  const schema = await fetchRemoteSchema('https://example.com/schema.json', {
    fetchImpl: async () => new Response('{"minimum":10.000000000000000001,"maximum":9007199254740993}', { status: 200 }),
  });
  assert.match(schema, /10\.000000000000000001/);
  assert.match(schema, /9007199254740993/);
  assert.equal(validateWithSchema('10', schema).valid, false);
  assert.equal(validateWithSchema('9007199254740994', schema).valid, false);
  for (const content of ['123', '[]']) {
    await assert.rejects(fetchRemoteSchema('https://example.com/schema.json', {
      fetchImpl: async () => new Response(content, { status: 200 }),
    }), /must be a JSON object or boolean/);
  }
});
