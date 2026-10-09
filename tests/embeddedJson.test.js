import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmbeddedJsonExpandEdit,
  detectEmbeddedJsonFormat,
  expandAllEmbeddedJson,
  findJsonStringLiteralAt,
  parseEmbeddedJsonString,
} from '../src/lib/services/embeddedJson.js';
import { buildJsonTreeModel } from '../src/lib/services/jsonTreeModel.js';

/** @param {string} content @param {{ start: number; end: number; text: string }} edit */
function applySourceEdit(content, edit) {
  return content.slice(0, edit.start) + edit.text + content.slice(edit.end);
}

test('detects strings that encode JSON objects or arrays', () => {
  assert.equal(parseEmbeddedJsonString('{"a":1}').ok, true);
  assert.equal(parseEmbeddedJsonString(' [1, 2] ').ok, true);
  assert.equal(parseEmbeddedJsonString(JSON.stringify(JSON.stringify({ a: 1 }))).ok, true);
  assert.equal(parseEmbeddedJsonString('hello').ok, false);
  assert.equal(parseEmbeddedJsonString('{not json}').ok, false);
  assert.equal(parseEmbeddedJsonString('"plain"').ok, false);
  assert.equal(parseEmbeddedJsonString('123').ok, false);
  assert.equal(parseEmbeddedJsonString(42).ok, false);
});

test('detects the indentation and line breaks a document uses', () => {
  assert.deepEqual(detectEmbeddedJsonFormat('{\r\n    "a": 1\r\n}'), { lineBreak: '\r\n', indentUnit: '    ' });
  assert.deepEqual(detectEmbeddedJsonFormat('{\n\t"a": 1\n}'), { lineBreak: '\n', indentUnit: '\t' });
  assert.deepEqual(detectEmbeddedJsonFormat('{"a":1}'), { lineBreak: '', indentUnit: '  ' });
});

test('expands a nested JSON string in place with matching indentation', () => {
  const content = `{
  "outer": {
    "payload": "{\\"id\\":1,\\"tags\\":[\\"a\\"]}"
  }
}`;
  const node = buildJsonTreeModel(content).nodeIndex.get('/outer/payload');
  const result = createEmbeddedJsonExpandEdit(content, node);

  assert.equal(result.ok, true);
  assert.equal(applySourceEdit(content, result.edit), `{
  "outer": {
    "payload": {
      "id": 1,
      "tags": [
        "a"
      ]
    }
  }
}`);
});

test('expands double-escaped JSON strings and keeps minified documents compact', () => {
  const inner = JSON.stringify('[{"big":12345678901234567890}]');
  const content = `{"list":${JSON.stringify(inner)}}`;
  const node = buildJsonTreeModel(content).nodeIndex.get('/list');
  const result = createEmbeddedJsonExpandEdit(content, node);

  assert.equal(result.ok, true);
  assert.equal(applySourceEdit(content, result.edit), '{"list":[{"big":12345678901234567890}]}');
});

test('refuses to expand strings that are not JSON', () => {
  const content = '{"name": "Alice"}';
  const node = buildJsonTreeModel(content).nodeIndex.get('/name');
  assert.equal(createEmbeddedJsonExpandEdit(content, node).ok, false);
});

test('expands every JSON string, including ones revealed by an outer expansion', () => {
  const deep = JSON.stringify({ level: 2 });
  const content = `{
  // keep me
  "a": ${JSON.stringify(JSON.stringify({ inner: deep }))},
  "b": [${JSON.stringify('[1,2]')}, "text"]
}`;

  const result = expandAllEmbeddedJson(content);

  assert.equal(result.count, 3);
  assert.equal(result.content, `{
  // keep me
  "a": {
    "inner": {
      "level": 2
    }
  },
  "b": [[
    1,
    2
  ], "text"]
}`);
});

test('expand all reports zero when nothing is embedded', () => {
  const content = '{"a": "b"}';
  assert.deepEqual(expandAllEmbeddedJson(content), { content, count: 0 });
});

test('finds the string literal under the cursor and tells keys from values', () => {
  const line = '  "payload": "{\\"id\\":1}", // "{}"';
  const value = findJsonStringLiteralAt(line, 16);
  assert.deepEqual(value, { start: 13, end: 25, value: '{"id":1}', isKey: false });
  assert.equal(findJsonStringLiteralAt(line, 4)?.isKey, true);
  assert.equal(findJsonStringLiteralAt(line, 31), null);
  assert.equal(findJsonStringLiteralAt('  "a": 1,', 8), null);
});

test('builds a Monaco edit for the JSON string value under the cursor', async () => {
  const { createEmbeddedJsonCodeActionEdit } = await import('../src/lib/services/embeddedJsonCodeActions.js');
  const lines = ['{', '    "payload": "{\\"id\\":1}"', '}'];
  const model = {
    getLineContent: (lineNumber) => lines[lineNumber - 1],
    getLineLength: (lineNumber) => lines[lineNumber - 1].length,
    getLineCount: () => lines.length,
    getEOL: () => '\n',
    getOptions: () => ({ insertSpaces: true, indentSize: 4 }),
  };

  assert.deepEqual(createEmbeddedJsonCodeActionEdit(model, 2, 20), {
    range: { startLineNumber: 2, startColumn: 16, endLineNumber: 2, endColumn: 28 },
    text: '{\n        "id": 1\n    }',
  });
  assert.equal(createEmbeddedJsonCodeActionEdit(model, 2, 7), null);
});
