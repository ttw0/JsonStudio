import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { getJson5FoldingRanges } from '../src/lib/services/json5Folding.js';
import { parseJsonSourceModel } from '../src/lib/services/jsonSourceModel.js';
import { sanitizeRanges } from 'monaco-editor/esm/vs/editor/contrib/folding/browser/syntaxRangeProvider.js';

function modelFor(content) {
  const lines = content.split(/\r\n|\r|\n/);
  return {
    getLineCount: () => lines.length,
    getLineContent: line => lines[line - 1],
  };
}

function rangesFromSourceModel(content) {
  const ranges = new Map();
  const nodes = [parseJsonSourceModel(content)];
  const lineAt = offset => content.slice(0, offset).split(/\r\n|\r|\n/).length;
  while (nodes.length) {
    const node = nodes.pop();
    if (node.kind === 'object') nodes.push(...node.entries.map(entry => entry.value));
    else if (node.kind === 'array') nodes.push(...node.items);
    else continue;

    const start = lineAt(node.start);
    const end = lineAt(node.end - 1) - 1;
    if (start < end) ranges.set(start, Math.max(ranges.get(start) ?? 0, end));
  }
  return [...ranges].sort((a, b) => a[0] - b[0]).map(([start, end]) => ({ start, end }));
}

test('matches independent source-model ranges for 500 deterministic nested documents', () => {
  let seed = 74;
  const random = max => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed >>> 8) % max;
  };
  const scalars = ['quotes " \\\\ } [ // /*', 'line\nbreak', '\u2028\u2029', true, false, null, 79];
  const value = depth => {
    if (depth === 0 || random(4) === 0) return scalars[random(scalars.length)];
    const children = Array.from({ length: random(4) }, () => value(depth - 1));
    return random(2)
      ? children
      : Object.fromEntries(children.map((child, index) => [`key_${index}_}[`, child]));
  };
  const separators = ['\n', '\r\n', '\r', ' ', '\n\t', '\n    '];

  for (let sample = 0; sample < 500; sample += 1) {
    const content = JSON.stringify({ root: value(5), tail: sample }, null, 2)
      .replace(/\n */g, () => separators[random(separators.length)]);
    assert.deepEqual(
      getJson5FoldingRanges(modelFor(content)),
      rangesFromSourceModel(content),
      `folding differs from parsed structure for sample ${sample}: ${content}`,
    );
  }
});

test('keeps the root fold when 20000 child nodes exceed the Monaco region limit', t => {
  const content = `[\n${Array.from({ length: 20000 }, (_, index) => `{\n"id": ${index}\n}`).join(',\n')}\n]`;
  const model = modelFor(content);
  const started = performance.now();
  const ranges = getJson5FoldingRanges(model);
  t.diagnostic(`Scanned ${content.length} characters and ${ranges.length} ranges in ${(performance.now() - started).toFixed(1)} ms`);

  assert.equal(ranges.length, 20001);
  const regions = sanitizeRanges(
    ranges.map(range => ({ ...range, rank: 0 })),
    { limit: 5000, update() {} },
  );
  assert.equal(regions.length, 5000);
  assert.equal(regions.getStartLineNumber(0), 1);
  assert.equal(regions.getEndLineNumber(0), model.getLineCount() - 1);
});

test('scans repeated inline comments without folding them or rescanning their trailing whitespace', t => {
  const content = `{${'/* inline */'.repeat(8000)}${' '.repeat(60000)}\n"value": 1\n}`;
  assert.equal(parseJsonSourceModel(content, { dialect: 'JSON5' }).value.value, 1);
  const started = performance.now();
  const ranges = getJson5FoldingRanges(modelFor(content));
  t.diagnostic(`Scanned ${content.length} characters with 8000 inline comments in ${(performance.now() - started).toFixed(1)} ms`);
  assert.deepEqual(ranges, [{ start: 1, end: 2 }]);
});
