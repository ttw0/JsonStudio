import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getJson5FoldingRanges,
  registerJsonFoldingProviders,
} from '../src/lib/services/json5Folding.js';

function createMonaco() {
  const providers = new Map();
  const defaults = {
    modeConfiguration: {
      foldingRanges: true,
      diagnostics: true,
      completionItems: true,
      tokens: true,
    },
  };
  return {
    languages: {
      json: { jsonDefaults: defaults },
      registerFoldingRangeProvider(selector, provider) {
        const { language, exclusive } = selector;
        assert.equal(exclusive, true, 'structural folding must not merge with another provider');
        assert.equal(providers.has(language), false, 'provider must not be registered twice');
        providers.set(language, provider);
      },
    },
    providers,
  };
}

test('registers the same worker-independent folding for JSON and JSON5', () => {
  const monaco = createMonaco();
  registerJsonFoldingProviders(monaco);

  assert.deepEqual([...monaco.providers.keys()], ['json', 'json5']);
  for (const provider of monaco.providers.values()) {
    assert.equal(provider.provideFoldingRanges, getJson5FoldingRanges);
    const lines = ['{"nested": {', '"value": 1', '},', '"tail": 2', '}'];
    assert.deepEqual(provider.provideFoldingRanges({
      getLineCount: () => lines.length,
      getLineContent: line => lines[line - 1],
    }), [{ start: 1, end: 4 }]);
  }
});

test('does not change JSON diagnostics, completion, tokenization or worker configuration', () => {
  const monaco = createMonaco();
  registerJsonFoldingProviders(monaco);

  assert.deepEqual(monaco.languages.json.jsonDefaults.modeConfiguration, {
    foldingRanges: true,
    diagnostics: true,
    completionItems: true,
    tokens: true,
  });
});

test('registration is idempotent per Monaco instance, not per language or component', () => {
  const first = createMonaco();
  const second = createMonaco();
  registerJsonFoldingProviders(first);
  registerJsonFoldingProviders(first);
  registerJsonFoldingProviders(second);

  assert.equal(first.providers.size, 2);
  assert.equal(second.providers.size, 2);
});
