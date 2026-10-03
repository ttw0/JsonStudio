import { expect, test } from '@playwright/test';
import {
  installTauriEditorHarness,
  pasteIntoEditor,
} from './helpers/editorHarness.js';

const DOCUMENT = {
  first: 'one',
  second: 'two',
  profile: { name: 'Alice', age: 20 },
};
const SOURCE = JSON.stringify(DOCUMENT);

async function editorState(page) {
  return page.evaluate(async () => {
    const { initMonaco } = await import('/src/lib/services/monaco.ts');
    const { getDocumentContent } = await import('/src/lib/stores/documentStore.ts');
    const editor = (await initMonaco()).editor.getEditors()[0];
    const model = editor.getModel();
    return {
      value: editor.getValue(),
      document: getDocumentContent('editor-test-tab'),
      eol: model.getEOL(),
      selection: model.getValueInRange(editor.getSelection()),
    };
  });
}

async function openPastedDocument(page) {
  await installTauriEditorHarness(page, '', { showTreeView: true });
  await page.goto('/');
  const surface = page.getByTestId('json-editor').locator('.view-lines');
  await expect(surface).toBeVisible();
  await surface.click();
  await pasteIntoEditor(page, SOURCE);
  await expect(page.getByTestId('editor-line-count')).toContainText('9 lines');
  await expect(page.getByTestId('tree-ready')).toBeAttached();
}

async function toolValues(page) {
  return page.evaluate(async () => {
    const { initMonaco } = await import('/src/lib/services/monaco.ts');
    return (await initMonaco()).editor.getEditors().map(editor => editor.getValue());
  });
}

for (const platform of [
  { name: 'Windows', navigator: 'Win32', ua: 'Windows NT 10.0; Win64; x64', eol: '\r\n' },
  { name: 'macOS', navigator: 'MacIntel', ua: 'Macintosh; Intel Mac OS X 10_15_7', eol: '\n' },
]) {
  test.describe(platform.name, () => {
    test.use({
      userAgent: `Mozilla/5.0 (${platform.ua}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36`,
    });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(value => {
        Object.defineProperty(navigator, 'platform', { get: () => value });
      }, platform.navigator);
    });

    test('pasted content stays identical to the Monaco model', async ({ page }) => {
      await openPastedDocument(page);
      const state = await editorState(page);
      expect(state.eol).toBe(platform.eol);
      expect(state.document).toBe(state.value);
      expect(JSON.parse(state.value)).toEqual(DOCUMENT);
    });

    test('Tree selection and edits use the correct character offsets', async ({ page }) => {
      await openPastedDocument(page);
      const row = page.locator('[data-tree-path="/profile/name"]');
      await row.click();
      expect((await editorState(page)).selection).toBe('"name": "Alice",');
      await row.locator('[data-tree-edit-kind="value"]').dblclick();
      const input = row.locator('.tree-edit-input');
      await input.fill('Bob');
      await input.press('Enter');
      await expect(row.locator('.tree-value')).toHaveText('Bob');
      const state = await editorState(page);
      expect(JSON.parse(state.value)).toEqual({
        ...DOCUMENT,
        profile: { ...DOCUMENT.profile, name: 'Bob' },
      });
      expect(state.document).toBe(state.value);
    });

    test('Grid edits do not overwrite adjacent JSON characters', async ({ page }) => {
      await openPastedDocument(page);
      await page.getByRole('button', { name: 'Grid', exact: true }).click();
      const row = page.locator('.gv-tr').filter({
        has: page.locator('.gv-td').first().getByText('second', { exact: true }),
      });
      await row.locator('.gv-td').nth(1).getByRole('button', { name: 'Edit value' }).click();
      const input = row.locator('.gv-edit-input');
      await input.fill('updated');
      await input.press('Enter');
      await expect(row).toContainText('updated');
      expect(JSON.parse((await editorState(page)).value)).toEqual({
        ...DOCUMENT, second: 'updated',
      });
    });

    test('toolbar transformations and undo preserve the document', async ({ page }) => {
      await openPastedDocument(page);
      const commandKey = platform.name === 'Windows' ? 'Control' : 'Meta';
      await page.keyboard.press(`${commandKey}+Shift+m`);
      await expect.poll(async () => (await editorState(page)).value).toBe(SOURCE);
      await page.getByRole('button', { name: 'Escape', exact: true }).click();
      await expect.poll(async () => JSON.parse((await editorState(page)).value)).toBe(SOURCE);
      await page.getByRole('button', { name: 'Unescape', exact: true }).click();
      await expect.poll(async () => (await editorState(page)).value).toBe(SOURCE);
      await page.getByRole('button', { name: 'Prettify', exact: true }).click();
      await expect(page.getByTestId('editor-line-count')).toContainText('9 lines');
      const before = (await editorState(page)).value;
      await page.getByRole('button', { name: 'Min+Esc', exact: true }).click();
      await expect.poll(async () => JSON.parse((await editorState(page)).value)).toBe(SOURCE);
      await page.getByTestId('json-editor').locator('.view-lines').click();
      await page.keyboard.press(`${commandKey}+z`);
      await expect.poll(async () => (await editorState(page)).value).toBe(before);
    });

    test('restored BOM-prefixed content is synchronized before toolbar actions', async ({ page }) => {
      await installTauriEditorHarness(page, `\uFEFF${JSON.stringify(DOCUMENT, null, 2)}`);
      await page.goto('/');
      await expect(page.getByTestId('json-editor').locator('.view-lines')).toBeVisible();
      await expect.poll(async () => {
        const state = await editorState(page);
        return state.document === state.value;
      }).toBe(true);
      await page.getByRole('button', { name: 'Minify', exact: true }).click();
      await expect.poll(async () => (await editorState(page)).value).toBe(SOURCE);
    });

    test('Diff paste and toolbar operations stay on the active pane', async ({ page }) => {
      await installTauriEditorHarness(page);
      await page.goto('/');
      await page.getByRole('button', { name: 'Diff', exact: true }).click();
      const original = page.locator('.monaco-diff-editor .editor.original .view-lines');
      await expect(original).toBeVisible();
      await original.click();
      await pasteIntoEditor(page, SOURCE);
      await expect.poll(async () => (await toolValues(page))[0].includes('\n')).toBe(true);
      await page.getByRole('button', { name: 'Minify', exact: true }).click();
      await expect.poll(async () => (await toolValues(page))[0]).toBe(SOURCE);
      expect((await toolValues(page))[1]).toBe('');
    });

    test('Convert accepts CRLF INI and lets the JSON output be minified', async ({ page }) => {
      await installTauriEditorHarness(page);
      await page.goto('/');
      await page.getByRole('button', { name: 'Convert', exact: true }).click();
      await page.locator('.cv-custom-select').click();
      await page.getByRole('button', { name: 'INI', exact: true }).click();
      await page.locator('.cv-divider').getByRole('button', { name: 'Toggle conversion direction' }).click();
      await page.locator('.cv-pane').first().locator('.view-lines').click();
      await page.keyboard.insertText('[server]\r\nhost=localhost\r\nport=8080\r\n');
      const result = { server: { host: 'localhost', port: 8080 } };
      await expect.poll(async () => {
        const output = (await toolValues(page))[1];
        return output ? JSON.parse(output) : null;
      }).toEqual(result);
      await page.getByRole('button', { name: 'Minify', exact: true }).click();
      await expect.poll(async () => (await toolValues(page))[1]).toBe(JSON.stringify(result));
    });

    test('Codegen handles CRLF JSON input', async ({ page }) => {
      await installTauriEditorHarness(page);
      await page.goto('/');
      await page.getByRole('button', { name: 'Codegen', exact: true }).click();
      await page.locator('.cg-pane').first().locator('.view-lines').click();
      await page.keyboard.insertText(JSON.stringify(DOCUMENT, null, 2).replaceAll('\n', '\r\n'));
      await expect.poll(async () => (await toolValues(page))[1]).toContain('export interface MyModel');
      expect((await toolValues(page))[1]).toContain('profile:');
    });

    test('Schema generates and formats JSON containing CRLF', async ({ page }) => {
      await openPastedDocument(page);
      await page.getByRole('button', { name: 'Schema', exact: true }).click();
      await expect.poll(async () => {
        const output = (await toolValues(page))[1];
        return output ? JSON.parse(output).properties?.profile?.type : null;
      }).toBe('object');
      await page.getByRole('button', { name: 'Minify', exact: true }).click();
      await expect.poll(async () => (await toolValues(page))[0]).toBe(SOURCE);
      await page.getByRole('button', { name: 'Prettify', exact: true }).click();
      await expect.poll(async () => (await toolValues(page))[0].includes('\n')).toBe(true);
    });

    test('JSONL reads BOM and CRLF records without reformatting the source', async ({ page }) => {
      const source = '\uFEFF{"id":1,"name":"Alice"}\r\n{"id":2,"name":"Bob"}\r\n';
      await installTauriEditorHarness(page, source, {
        fileName: 'events.jsonl',
        filePath: platform.name === 'Windows' ? 'C:\\Data\\events.jsonl' : '/tmp/events.jsonl',
      });
      await page.goto('/');
      const view = page.getByTestId('jsonl-view');
      await expect(view.locator('.jsonl-item')).toHaveCount(2);
      await expect(page.getByTestId('editor-jsonl-record-count')).toContainText('2 records');
      await view.getByRole('button', { name: 'View source' }).click();
      await expect(page.getByTestId('json-editor')).toBeVisible();
      expect(JSON.parse((await editorState(page)).value.split('\r\n')[0])).toEqual({ id: 1, name: 'Alice' });
      await expect(page.getByRole('button', { name: 'Minify', exact: true })).toBeDisabled();
    });

    test('caption buttons invoke window commands without starting a drag', async ({ page }) => {
      await installTauriEditorHarness(page, '', {
        isTauri: true,
        desktopPlatform: 'windows',
      });
      await page.goto('/');
      await page.getByRole('button', { name: 'Minimize', exact: true }).click();
      await page.getByRole('button', { name: 'Maximize', exact: true }).click();
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      const commands = await page.evaluate(() => window.__JSON_STUDIO_WINDOW_COMMANDS__);
      expect(commands).toContain('plugin:window|minimize');
      expect(commands).toContain('plugin:window|toggle_maximize');
      expect(commands).toContain('plugin:window|close');
      expect(commands).not.toContain('plugin:window|start_dragging');
    });
  });
}
