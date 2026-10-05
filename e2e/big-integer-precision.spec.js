import { expect, test } from '@playwright/test';
import { parseBigInt } from '../src/lib/utils/jsonBigInt.js';
import { installTauriEditorHarness, pasteIntoEditor } from './helpers/editorHarness.js';

const SOURCE = '{"id":9007199254740993,"name":"Alice","nested":{"id":123456789012345678901234567890}}';
const EXPECTED = parseBigInt(SOURCE);

async function value(page) {
  return page.evaluate(async () => {
    const { initMonaco } = await import('/src/lib/services/monaco.ts');
    return (await initMonaco()).editor.getEditors()[0].getValue();
  });
}

async function toolValues(page) {
  return page.evaluate(async () => {
    const { initMonaco } = await import('/src/lib/services/monaco.ts');
    return (await initMonaco()).editor.getEditors().map(editor => editor.getValue());
  });
}

async function open(page, content = SOURCE, pasted = false) {
  await installTauriEditorHarness(page, pasted ? '' : content, { showTreeView: true });
  await page.addInitScript(() => {
    window.__copiedText = '';
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async text => { window.__copiedText = text; } },
    });
  });
  await page.goto('/');
  const surface = page.getByTestId('json-editor').locator('.view-lines');
  await expect(surface).toBeVisible({ timeout: 30_000 });
  if (pasted) {
    await surface.click();
    await pasteIntoEditor(page, content);
  }
  await expect(page.getByTestId('tree-ready')).toBeAttached();
}

for (const platform of [
  { name: 'Windows', navigator: 'Win32', ua: 'Windows NT 10.0; Win64; x64' },
  { name: 'macOS', navigator: 'MacIntel', ua: 'Macintosh; Intel Mac OS X 10_15_7' },
]) {
  test.describe(platform.name, () => {
    test.use({ userAgent: `Mozilla/5.0 (${platform.ua}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36` });
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(name => {
        Object.defineProperty(navigator, 'platform', { get: () => name });
      }, platform.navigator);
    });

    test('paste, formatting, standardization, and key sorting keep numeric digits', async ({ page }) => {
      await open(page, SOURCE, true);
      expect(parseBigInt(await value(page))).toEqual(EXPECTED);
      await page.getByRole('button', { name: 'Prettify', exact: true }).click();
      expect(parseBigInt(await value(page))).toEqual(EXPECTED);
      await page.getByRole('button', { name: 'More transform options', exact: true }).click();
      await page.getByRole('button', { name: 'To JSON', exact: true }).click();
      expect(parseBigInt(await value(page))).toEqual(EXPECTED);
      await page.getByRole('button', { name: 'More transform options', exact: true }).click();
      await page.getByRole('button', { name: 'Key ↑', exact: true }).click();
      expect(parseBigInt(await value(page))).toEqual(EXPECTED);
      await expect(page.locator('[data-tree-path="/id"] .tree-value')).toHaveText('9007199254740993');
      await page.getByRole('button', { name: 'Minify', exact: true }).click();
      await expect.poll(() => value(page)).toBe(SOURCE);
      await page.getByRole('button', { name: 'Escape', exact: true }).click();
      expect(parseBigInt(parseBigInt(await value(page)))).toEqual(EXPECTED);
      await page.getByRole('button', { name: 'Unescape', exact: true }).click();
      expect(parseBigInt(await value(page))).toEqual(EXPECTED);
      await page.getByRole('button', { name: 'Min+Esc', exact: true }).click();
      expect(parseBigInt(parseBigInt(await value(page)))).toEqual(EXPECTED);
    });

    test('Tree editing, dragging, copying, and save preserve unaffected integers', async ({ page }) => {
      await open(page);
      const id = page.locator('[data-tree-path="/id"]');
      await id.hover();
      await id.getByRole('button', { name: 'Copy value', exact: true }).click();
      expect(await page.evaluate(() => window.__copiedText)).toBe('9007199254740993');
      const name = page.locator('[data-tree-path="/name"]');
      await name.locator('[data-tree-edit-kind="value"]').dblclick();
      await name.locator('.tree-edit-input').fill('Bob');
      await name.locator('.tree-edit-input').press('Enter');
      await expect(name.locator('.tree-value')).toHaveText('Bob');
      const from = await name.boundingBox();
      const to = await id.boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.2, { steps: 8 });
      await page.mouse.up();
      await expect.poll(async () => parseBigInt(await value(page))).toEqual({ ...EXPECTED, name: 'Bob' });
      await page.evaluate(() => {
        const invoke = window.__TAURI_INTERNALS__.invoke;
        window.__TAURI_INTERNALS__.invoke = async (command, args) => {
          if (command === 'save_file_dialog') {
            window.__savedText = args.content;
            return '/tmp/precision.json';
          }
          return invoke(command, args);
        };
      });
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.__savedText ?? '')).toContain('9007199254740993');
      expect(parseBigInt(await page.evaluate(() => window.__savedText))).toEqual({ ...EXPECTED, name: 'Bob' });
    });

    test('Grid supports editing a large integer and copying its row', async ({ page }) => {
      await open(page);
      await page.getByRole('button', { name: 'Grid', exact: true }).click();
      const row = page.locator('.gv-tr').filter({
        has: page.locator('.gv-td').first().getByText('id', { exact: true }),
      });
      const cell = row.locator('.gv-td').nth(1);
      await cell.getByRole('button', { name: 'Edit value', exact: true }).click();
      await cell.locator('.gv-edit-input').fill('18446744073709551615');
      await cell.locator('.gv-edit-input').press('Enter');
      await expect(cell).toContainText('18446744073709551615');
      expect(parseBigInt(await value(page))).toEqual({ ...EXPECTED, id: 18446744073709551615n });
      await row.locator('.gv-td').first().locator('.gv-cell').click();
      await page.keyboard.press(platform.name === 'Windows' ? 'Control+c' : 'Meta+c');
      await expect.poll(() => page.evaluate(() => window.__copiedText)).toContain('18446744073709551615');
    });

    test('JMESPath filters distinguish adjacent large IDs in the actual tree', async ({ page }) => {
      await open(page, '{"records":[{"id":9007199254740992,"name":"left"},{"id":9007199254740993,"name":"right"}]}');
      await page.getByPlaceholder('JMESPath query...').fill('records[?id == `9007199254740993`].name');
      await expect(page.locator('[data-tree-path="/records/1/name"]').locator('..')).toHaveClass(/tree-node-matched/);
      await expect(page.locator('.tree-node-matched [data-tree-path="/records/0/name"]')).toHaveCount(0);
    });

    test('Schema checks exact bounds and accepts adjacent integer enums', async ({ page }) => {
      await open(page);
      await page.getByRole('button', { name: 'Schema', exact: true }).click();
      await page.locator('.sv-tabs').getByRole('button', { name: 'Validate', exact: true }).click();
      await page.evaluate(async () => {
        const { initMonaco } = await import('/src/lib/services/monaco.ts');
        (await initMonaco()).editor.getEditors()[1].setValue('{"type":"object","properties":{"id":{"maximum":9007199254740992}}}');
      });
      await page.locator('.sv-divider').getByRole('button', { name: 'Validate', exact: true }).click();
      await expect(page.locator('.sv-result-badge.is-invalid')).toBeVisible();
      await expect(page.locator('.sv-error-list')).toContainText('/id');
      await page.evaluate(async () => {
        const { initMonaco } = await import('/src/lib/services/monaco.ts');
        (await initMonaco()).editor.getEditors()[1].setValue('{"type":"object","properties":{"id":{"enum":[9007199254740992,9007199254740993]}}}');
      });
      await page.locator('.sv-divider').getByRole('button', { name: 'Validate', exact: true }).click();
      await expect(page.locator('.sv-result-badge.is-valid')).toBeVisible();
      await expect(page.locator('.sv-error-list')).toHaveCount(0);
    });

    test('JSON5 hexadecimal and exponent-form integers minify without rounding', async ({ page }) => {
      await open(page, '{id:0x20000000000001, exponent:9.007199254740993e15, stringId:"9007199254740993"}');
      await page.getByRole('button', { name: 'Minify', exact: true }).click();
      await expect.poll(() => value(page)).toBe('{"id":9007199254740993,"exponent":9007199254740993,"stringId":"9007199254740993"}');
    });

    test('YAML round trips and JSON output tools keep numbers distinct from strings', async ({ page }) => {
      const source = '{"id":9007199254740993,"stringId":"9007199254740993","exponentString":"9.007199254740993e15"}';
      await open(page, source);
      await page.getByRole('button', { name: 'Convert', exact: true }).click();
      await expect.poll(async () => (await toolValues(page))[1]).toContain('9007199254740993');
      await page.locator('.cv-divider').getByRole('button', { name: 'Toggle conversion direction' }).click();
      await expect.poll(async () => {
        const output = (await toolValues(page))[1];
        return output ? parseBigInt(output) : null;
      }).toEqual(parseBigInt(source));
      await page.getByRole('button', { name: 'Minify', exact: true }).click();
      await expect.poll(async () => (await toolValues(page))[1]).toBe(source);
    });

    for (const tool of [
      { name: 'Convert', prefix: 'cv', target: 'XML', command: 'json_to_xml' },
      { name: 'Codegen', prefix: 'cg', target: 'Protobuf', command: 'json_to_code' },
    ]) {
      test(`${tool.name} ignores stale results after editing a large integer`, async ({ page }) => {
        await open(page, '{"id":9007199254740993}');
        await page.evaluate(command => {
          const invoke = window.__TAURI_INTERNALS__.invoke;
          window.__pendingConversions = [];
          window.__TAURI_INTERNALS__.invoke = async (name, args) => {
            if (name === command) {
              return new Promise(resolve => window.__pendingConversions.push({ args, resolve }));
            }
            return invoke(name, args);
          };
        }, tool.command);
        await page.getByRole('button', { name: tool.name, exact: true }).click();
        await expect.poll(async () => (await toolValues(page)).length).toBe(2);
        await page.evaluate(async () => {
          const { initMonaco } = await import('/src/lib/services/monaco.ts');
          (await initMonaco()).editor.getEditors()[0].setValue('{"id":9007199254740993}');
        });
        await page.locator(`.${tool.prefix}-custom-select`).click();
        await page.getByRole('button', { name: tool.target, exact: true }).click();
        await expect.poll(() => page.evaluate(() => window.__pendingConversions.length)).toBeGreaterThan(0);
        await page.evaluate(async () => {
          const { initMonaco } = await import('/src/lib/services/monaco.ts');
          (await initMonaco()).editor.getEditors()[0].setValue('{"id":9007199254740995}');
          window.__pendingConversions.forEach(request => request.resolve('stale'));
          await new Promise(resolve => requestAnimationFrame(resolve));
        });
        expect((await toolValues(page))[1]).not.toBe('stale');
        await expect.poll(() => page.evaluate(() => window.__pendingConversions.at(-1)?.args.content)).toBe('{"id":9007199254740995}');
        await page.evaluate(() => window.__pendingConversions.at(-1).resolve('current'));
        await expect.poll(async () => (await toolValues(page))[1]).toBe('current');
      });
    }
  });
}
