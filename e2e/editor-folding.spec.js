import { expect, test } from '@playwright/test';
import { installTauriEditorHarness } from './helpers/editorHarness.js';

function foldGlyph(page, editor, lineNumber) {
  return editor
    .locator('.margin-view-overlays > div')
    .filter({ has: page.locator('.line-numbers', { hasText: new RegExp(`^${lineNumber}$`) }) })
    .locator('.cldr');
}

async function mainModelState(page) {
  return page.evaluate(async () => {
    const { initMonaco } = await import('/src/lib/services/monaco.ts');
    const model = (await initMonaco()).editor.getEditors()[0].getModel();
    return { content: model.getValue(), version: model.getVersionId() };
  });
}

const NESTED_JSON = `{
  "1": {
    "ChickenNuggets": {
      "0": {
        "IncomeCoins": 15
      },
      "1": {
        "IncomeCoins": 17
      },
      "2": {
        "IncomeCoins": 19
      }
    },
    "Categories": "SIDEDISH",
    "Type": "MEAL"
  },
  "2": {
    "value": 2
  }
}`;

test('folds a JSON object through its matching closing brace', async ({ page }) => {
  await installTauriEditorHarness(page, NESTED_JSON);
  await page.goto('/');

  const editor = page.getByTestId('json-editor');
  await expect(editor.locator('.view-lines')).toBeVisible();

  await foldGlyph(page, editor, 2).click();

  const viewLines = editor.locator('.view-lines');
  await expect(viewLines).toContainText('"1": {');
  await expect(viewLines).toContainText('"2": {');
  await expect(viewLines).not.toContainText('"ChickenNuggets": {');
  await expect(viewLines).not.toContainText('"IncomeCoins": 17');
});

const ISSUE_79_JSON = `{
  "source": "test.docx",
  "entities": 414,
  "entity_labels": {
    "labelA": 1,
    "labelB": 2
  },
  "ner_method": "llm",
  "rel_method": "llm"
}`;

test('folds the root object past nested fields and trailing properties', async ({ page }) => {
  await installTauriEditorHarness(page, ISSUE_79_JSON);
  await page.goto('/');

  const editor = page.getByTestId('json-editor');
  const viewLines = editor.locator('.view-lines');
  await expect(viewLines).toContainText('"rel_method": "llm"');

  await foldGlyph(page, editor, 1).click();

  await expect(viewLines).not.toContainText('"entity_labels": {');
  await expect(viewLines).not.toContainText('"ner_method": "llm"');
  await expect(viewLines).not.toContainText('"rel_method": "llm"');
});

test('folds an unindented JSON object through its closing brace', async ({ page }) => {
  const unindentedJson = ['{', '"nested":{', '"value":1', '},', '"tail":2', '}'].join('\n');
  await installTauriEditorHarness(page, unindentedJson);
  await page.goto('/');

  const editor = page.getByTestId('json-editor');
  const viewLines = editor.locator('.view-lines');
  await expect(viewLines).toContainText('"tail":2');

  await foldGlyph(page, editor, 1).click();

  await expect(viewLines).not.toContainText('"tail":2');
});

test('folds JSON5 after a continued string containing an escaped quote', async ({ page }) => {
  const content = [
    '{',
    "  text: 'foo\\",
    "\\'bar',",
    '  nested: {',
    '    value: 1',
    '  },',
    '  tail: 2',
    '}',
  ].join('\n');
  await installTauriEditorHarness(page, content);
  await page.goto('/');

  const editor = page.getByTestId('json-editor');
  const viewLines = editor.locator('.view-lines');
  await expect(viewLines).toContainText('tail: 2');

  await foldGlyph(page, editor, 1).click();

  await expect(viewLines).not.toContainText('nested: {');
  await expect(viewLines).not.toContainText('tail: 2');
});

test('folds JSON5 after a line comment terminated by a Unicode separator', async ({ page }) => {
  const content = [
    '{',
    '  // ignored } \u2028 nested: {',
    '    value: 1',
    '  },',
    '  tail: 2',
    '}',
  ].join('\n');
  await installTauriEditorHarness(page, content);
  await page.goto('/');

  const editor = page.getByTestId('json-editor');
  const viewLines = editor.locator('.view-lines');
  await expect(viewLines).toContainText('tail: 2');

  await foldGlyph(page, editor, 1).click();

  await expect(viewLines).not.toContainText('nested: {');
  await expect(viewLines).not.toContainText('tail: 2');
});

test('folds the parent when parent and child start on the same line', async ({ page }) => {
  const content = ['{"nested": {', '"value": 1', '},', '"tail": 2', '}'].join('\n');
  await installTauriEditorHarness(page, content);
  await page.goto('/');

  const editor = page.getByTestId('json-editor');
  const viewLines = editor.locator('.view-lines');
  await expect(viewLines).toContainText('"tail": 2');
  await foldGlyph(page, editor, 1).click();
  await expect(viewLines).not.toContainText('"tail": 2');
});

test('folding a child leaves a sibling on its closing line visible', async ({ page }) => {
  const content = ['{', '"nested": {', '"value": 1', '}, "tail": 2', '}'].join('\n');
  await installTauriEditorHarness(page, content);
  await page.goto('/');

  const editor = page.getByTestId('json-editor');
  const viewLines = editor.locator('.view-lines');
  await expect(viewLines).toContainText('"value": 1');
  await foldGlyph(page, editor, 2).click();
  await expect(viewLines).not.toContainText('"value": 1');
  await expect(viewLines).toContainText('"tail": 2');
});

test('Diff panes fold unindented JSON with the same structural rules', async ({ page }) => {
  const content = ['{', '"nested": {', '"value": 1', '},', '"tail": 2', '}'].join('\n');
  await installTauriEditorHarness(page, content);
  await page.goto('/');
  await expect(page.getByTestId('json-editor').locator('.view-lines')).toBeVisible();
  await page.getByRole('button', { name: 'Diff', exact: true }).click();
  const modifiedSurface = page.locator('.monaco-diff-editor .editor.modified .view-lines');
  await expect(modifiedSurface).toBeVisible();
  await page.evaluate(async value => {
    const { initMonaco } = await import('/src/lib/services/monaco.ts');
    (await initMonaco()).editor.getDiffEditors()[0].getModifiedEditor().setValue(value);
  }, content);

  for (const side of ['original', 'modified']) {
    const pane = page.locator(`.monaco-diff-editor .editor.${side}`);
    const viewLines = pane.locator('.view-lines');
    await expect(viewLines).toContainText('"tail": 2');
    await foldGlyph(page, pane, 1).click();
    await expect(viewLines).not.toContainText('"tail": 2');
  }
  for (const side of ['original', 'modified']) {
    await expect(page.locator(`.monaco-diff-editor .editor.${side} .view-lines`))
      .not.toContainText('"tail": 2');
  }
});

test('toolbar folding handles mixed scopes on one line and restores the document', async ({ page }) => {
  const content = ['[{"items": [', '{"value": 1}', ']},', '{"tail": 2}', ']'].join('\r\n');
  await installTauriEditorHarness(page, content);
  await page.goto('/');

  const viewLines = page.getByTestId('json-editor').locator('.view-lines');
  await expect(viewLines).toContainText('"tail": 2');
  await page.getByRole('button', { name: 'Fold', exact: true }).click();
  await expect(viewLines).not.toContainText('"value": 1');
  await expect(viewLines).not.toContainText('"tail": 2');
  await page.getByRole('button', { name: 'Unfold', exact: true }).click();
  await expect(viewLines).toContainText('"value": 1');
  await expect(viewLines).toContainText('"tail": 2');
});

test('Diff keeps folded nodes collapsed across editor settings updates', async ({ page }) => {
  await installTauriEditorHarness(page, ISSUE_79_JSON);
  await page.goto('/');
  await expect(page.getByTestId('json-editor').locator('.view-lines')).toBeVisible();
  await page.getByRole('button', { name: 'Diff', exact: true }).click();
  const modifiedSurface = page.locator('.monaco-diff-editor .editor.modified .view-lines');
  await expect(modifiedSurface).toBeVisible();
  await page.evaluate(async value => {
    const { initMonaco } = await import('/src/lib/services/monaco.ts');
    (await initMonaco()).editor.getDiffEditors()[0].getModifiedEditor().setValue(value);
  }, ISSUE_79_JSON);
  for (const side of ['original', 'modified']) {
    const pane = page.locator(`.monaco-diff-editor .editor.${side}`);
    await foldGlyph(page, pane, 1).click();
    await expect(pane.locator('.view-lines')).not.toContainText('"rel_method": "llm"');
  }
  await page.evaluate(async () => {
    const { settingsStore } = await import('/src/lib/stores/settings.ts');
    settingsStore.updateSettings({ fontSize: 15, lineHeight: 24 });
  });
  await expect.poll(() => page.evaluate(async () => {
    const monaco = await (await import('/src/lib/services/monaco.ts')).initMonaco();
    return monaco.editor.getDiffEditors()[0].getOriginalEditor().getOption(monaco.editor.EditorOption.fontSize);
  })).toBe(15);

  for (const side of ['original', 'modified']) {
    const pane = page.locator(`.monaco-diff-editor .editor.${side}`);
    await expect(pane.locator('.view-lines')).not.toContainText('"rel_method": "llm"');
    await foldGlyph(page, pane, 1).click();
    await expect(pane.locator('.view-lines')).toContainText('"rel_method": "llm"');
  }
});

test('keeps comment and region folding available alongside structural folding', async ({ page }) => {
  const content = [
    '{',
    '  // #region values',
    '  /* description',
    '     braces } ]',
    '  */',
    '  value: 1,',
    '  // #endregion',
    '  tail: 2',
    '}',
  ].join('\n');
  await installTauriEditorHarness(page, content);
  await page.goto('/');

  const editor = page.getByTestId('json-editor');
  const viewLines = editor.locator('.view-lines');
  await expect(viewLines).toContainText('braces } ]');
  const regionGlyph = foldGlyph(page, editor, 2);
  await regionGlyph.click();
  await expect(viewLines).not.toContainText('value: 1');
  await expect(viewLines).toContainText('tail: 2');
  await regionGlyph.click();

  await foldGlyph(page, editor, 3).click();
  await expect(viewLines).not.toContainText('braces } ]');
  await expect(viewLines).toContainText('value: 1');
});

test('folding preserves source and recomputes ranges after edits and undo', async ({ page }) => {
  await installTauriEditorHarness(page, ISSUE_79_JSON);
  await page.goto('/');
  const editor = page.getByTestId('json-editor');
  const viewLines = editor.locator('.view-lines');
  await expect(viewLines).toContainText('"rel_method": "llm"');
  const original = await mainModelState(page);

  await foldGlyph(page, editor, 1).click();
  await expect(viewLines).not.toContainText('"rel_method": "llm"');
  expect(await mainModelState(page)).toEqual(original);
  await foldGlyph(page, editor, 1).click();
  await expect(viewLines).toContainText('"rel_method": "llm"');
  expect(await mainModelState(page)).toEqual(original);

  const edited = ['{', '"nested": [', '{"value": 1}', '],', '"added": true', '}'].join('\n');
  await page.evaluate(async content => {
    const monaco = await (await import('/src/lib/services/monaco.ts')).initMonaco();
    const instance = monaco.editor.getEditors()[0];
    instance.pushUndoStop();
    instance.executeEdits('folding-test', [{ range: instance.getModel().getFullModelRange(), text: content }]);
    instance.pushUndoStop();
    instance.setPosition({ lineNumber: 1, column: 1 });
  }, edited);
  await expect(viewLines).toContainText('"added": true');
  const afterEdit = await mainModelState(page);
  await foldGlyph(page, editor, 1).click();
  await expect(viewLines).not.toContainText('"added": true');
  await expect(editor.locator('.line-numbers').filter({ hasText: /^6$/ })).toBeVisible();
  expect(await mainModelState(page)).toEqual(afterEdit);
  await foldGlyph(page, editor, 1).click();

  await page.evaluate(async () => {
    const monaco = await (await import('/src/lib/services/monaco.ts')).initMonaco();
    await monaco.editor.getEditors()[0].getModel().undo();
  });
  await expect(viewLines).toContainText('"rel_method": "llm"');
  expect((await mainModelState(page)).content).toBe(original.content);
  await foldGlyph(page, editor, 1).click();
  await expect(viewLines).not.toContainText('"rel_method": "llm"');
  await expect(editor.locator('.line-numbers').filter({ hasText: /^10$/ })).toBeVisible();
});

test('folds a 60002-line document through the full root despite region limits', async ({ page }) => {
  const content = `[\n${Array.from({ length: 20000 }, (_, index) => `{\n"id": ${index}\n}`).join(',\n')}\n]`;
  await installTauriEditorHarness(page, content);
  await page.goto('/');
  const editor = page.getByTestId('json-editor');
  await expect(editor.locator('.view-lines')).toContainText('"id": 0');
  const original = await mainModelState(page);
  await foldGlyph(page, editor, 1).click();
  await expect(editor.locator('.view-lines')).not.toContainText('"id": 0');
  await expect(editor.locator('.line-numbers').filter({ hasText: /^60002$/ })).toBeVisible();
  expect(await mainModelState(page)).toEqual(original);
  await page.screenshot({ path: test.info().outputPath('large-document-folded.png') });
  await foldGlyph(page, editor, 1).click();
  await expect(editor.locator('.view-lines')).toContainText('"id": 0');
  expect(await mainModelState(page)).toEqual(original);
});
