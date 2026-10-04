import test from 'node:test';
import assert from 'node:assert/strict';
import { getJson5FoldingRanges } from '../src/lib/services/json5Folding.js';
import { parseJsonDocument } from '../src/lib/services/jsonDocumentParse.js';
import { sanitizeRanges } from 'monaco-editor/esm/vs/editor/contrib/folding/browser/syntaxRangeProvider.js';

function foldingRanges(content, sanitize = false) {
  const lines = content.split(/\r\n|\r|\n/);
  const ranges = getJson5FoldingRanges({
    getLineCount: () => lines.length,
    getLineContent: (lineNumber) => lines[lineNumber - 1],
  });
  if (!sanitize) return ranges;

  const regions = sanitizeRanges(
    ranges.map(range => ({ ...range, rank: 0 })),
    { limit: 5000, update() {} },
  );
  return Array.from({ length: regions.length }, (_, index) => ({
    start: regions.getStartLineNumber(index),
    end: regions.getEndLineNumber(index),
  }));
}

test('folds the full root object in issue #79, including trailing properties', () => {
  const content = `{
  "source": "test.docx",
  "entities": 414,
  "entity_labels": {
    "labelA": 1,
    "labelB": 2
  },
  "ner_method": "llm",
  "rel_method": "llm"
}`;

  assert.equal(parseJsonDocument(content).data.rel_method, 'llm');
  assert.deepEqual(foldingRanges(content), [
    { start: 1, end: 9 },
    { start: 4, end: 6 },
  ]);
});

test('matches nested objects without relying on indentation', () => {
  const content = ['{', '"outer":{', '"value":1', '},', '"last":true', '}'].join('\n');

  assert.deepEqual(foldingRanges(content), [
    { start: 1, end: 5 },
    { start: 2, end: 3 },
  ]);
});

test('keeps the outermost range when nested scopes open on the same line', () => {
  const content = [
    '{"nested": {',
    '  "value": 1',
    '},',
    '"tail": 2',
    '}',
  ].join('\n');

  assert.equal(parseJsonDocument(content).data.tail, 2);
  assert.deepEqual(foldingRanges(content), [{ start: 1, end: 4 }]);
  assert.deepEqual(foldingRanges(content, true), [{ start: 1, end: 4 }]);
});

test('keeps the enclosing array when mixed scopes open on one line', () => {
  const content = [
    '[{"items": [',
    '  1, 2',
    ']},',
    '{"tail": true}',
    ']',
  ].join('\n');

  assert.equal(parseJsonDocument(content).data[1].tail, true);
  assert.deepEqual(foldingRanges(content), [{ start: 1, end: 4 }]);
  assert.deepEqual(foldingRanges(content, true), [{ start: 1, end: 4 }]);
});

test('returns ordered, unique ranges that survive Monaco sanitization', () => {
  const content = [
    '{',
    '  "first": {"items": [',
    '    {"value": 1}',
    '  ], "tail": 2},',
    '  "second": [',
    '    {',
    '      "value": 3',
    '    }',
    '  ]',
    '}',
  ].join('\n');
  const expected = [
    { start: 1, end: 9 },
    { start: 2, end: 3 },
    { start: 5, end: 8 },
    { start: 6, end: 7 },
  ];

  assert.deepEqual(foldingRanges(content), expected);
  assert.deepEqual(foldingRanges(content, true), expected);
});

test('does not hide siblings or enclosing delimiters on a shared closing line', () => {
  for (const lastLine of ['  }, "tail": 2', '  }}']) {
    const content = [
      '{',
      '  "nested": {',
      '    "value": 1',
      lastLine,
      ...(lastLine.endsWith('2') ? ['}'] : []),
    ].join('\n');
    assert.equal(parseJsonDocument(content).data.nested.value, 1);
    const ranges = foldingRanges(content, true);
    assert.deepEqual(ranges.find(range => range.start === 2), { start: 2, end: 3 });
  }
});

test('does not emit empty or single-line folds', () => {
  assert.deepEqual(foldingRanges('{\n}'), []);
  assert.deepEqual(foldingRanges('{\n  "value": 1 }'), []);
  assert.deepEqual(foldingRanges('{"nested": {"value": 1}}'), []);
});

test('ignores braces in strings and both kinds of JSON5 comments', () => {
  const content = [
    '[',
    '  {',
    '    text: "braces { [ } ] and //",',
    "    other: 'quoted \\' } still text',",
    '    // } ] [',
    '    /* [ {',
    '       } ] */',
    '    values: [',
    '      1,',
    '      2',
    '    ]',
    '  }',
    ']',
  ].join('\n');

  assert.equal(parseJsonDocument(content).dialect, 'JSON5');
  assert.deepEqual(foldingRanges(content), [
    { start: 1, end: 12 },
    { start: 2, end: 11 },
    { start: 6, end: 7, kind: { value: 'comment' } },
    { start: 8, end: 10 },
  ]);
});

test('preserves block-comment and nested region folding without consuming trailing code', () => {
  const content = [
    '{',
    '  // #region outer',
    '  // #region inner',
    '  /* ignored {',
    '     ignored ]',
    '  */ "value": 1,',
    '  // #endregion',
    '  "tail": 2',
    '  // #endregion',
    '}',
  ].join('\n');

  assert.equal(parseJsonDocument(content).data.tail, 2);
  assert.deepEqual(foldingRanges(content), [
    { start: 1, end: 9 },
    { start: 2, end: 8, kind: { value: 'region' } },
    { start: 3, end: 6, kind: { value: 'region' } },
    { start: 4, end: 5, kind: { value: 'comment' } },
  ]);
});

test('does not treat region markers in strings or block comments as directives', () => {
  const content = [
    '{',
    '  "text": "// #region not-a-region",',
    '  /* // #region not-a-region',
    '     // #endregion */',
    '  "tail": 2',
    '}',
  ].join('\n');

  assert.deepEqual(foldingRanges(content), [
    { start: 1, end: 5 },
    { start: 3, end: 4, kind: { value: 'comment' } },
  ]);
});

test('consumes line continuations without escaping the next line', () => {
  const content = [
    '{',
    "  text: 'foo\\",
    "\\'bar',",
    '  nested: {',
    '    value: 1',
    '  }',
    '}',
  ].join('\n');

  assert.equal(parseJsonDocument(content).data.text, "foo'bar");
  for (const source of [content, content.replaceAll('\n', '\r\n')]) {
    assert.deepEqual(foldingRanges(source), [
      { start: 1, end: 6 },
      { start: 4, end: 5 },
    ]);
  }
});

test('ends line comments at Unicode line terminators within a Monaco line', () => {
  for (const terminator of ['\u2028', '\u2029']) {
    const content = [
      '{',
      `  // ignored } ${terminator} nested: {`,
      '    value: 1',
      '  },',
      '  tail: 2',
      '}',
    ].join('\n');

    assert.equal(parseJsonDocument(content).data.nested.value, 1);
    assert.deepEqual(foldingRanges(content), [
      { start: 1, end: 5 },
      { start: 2, end: 3 },
    ]);
  }
});

test('does not treat Unicode line terminators inside strings as comments', () => {
  const content = [
    '{',
    "  text: 'ignored }\u2028 // [ \u2029',",
    '  nested: {',
    '    value: 1',
    '  }',
    '}',
  ].join('\n');

  assert.equal(parseJsonDocument(content).data.nested.value, 1);
  assert.deepEqual(foldingRanges(content), [
    { start: 1, end: 5 },
    { start: 3, end: 4 },
  ]);
});

test('recovers after an unterminated string on a hard line break', () => {
  const content = [
    '{',
    '  text: "unfinished',
    '  nested: {',
    '    value: 1',
    '  }',
    '}',
  ].join('\n');

  assert.throws(() => parseJsonDocument(content), SyntaxError);
  assert.deepEqual(foldingRanges(content), [
    { start: 1, end: 5 },
    { start: 3, end: 4 },
  ]);
});

test('does not close a parent using a mismatched nested delimiter', () => {
  assert.deepEqual(foldingRanges('{\n  array: [\n  }\n}'), []);
  assert.deepEqual(foldingRanges('{"nested": {"value": 1}}'), []);
});

test('scans deeply nested arrays without recursive traversal', () => {
  const depth = 1500;
  const content = `${Array(depth).fill('[').join('\n')}\n0\n${Array(depth).fill(']').join('\n')}`;
  const ranges = foldingRanges(content);

  assert.equal(ranges.length, depth);
  assert.deepEqual(ranges[0], { start: 1, end: depth * 2 });
});
