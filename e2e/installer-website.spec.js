import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commands = {
  curl: 'curl -fsSL https://jsonstudio.js.org/install.sh | sh',
  powershell: 'irm https://jsonstudio.js.org/install.ps1 | iex',
  npm: 'npx --yes @sundegan/jsonstudio install',
  brew: 'brew install --cask sundegan/tap/json-studio',
};

function contrastRatio(foreground, background) {
  const luminance = color => {
    const channels = color.match(/\d+/g).slice(0, 3).map(Number).map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const variants = ['en', 'zh'].flatMap(language => ['light', 'dark'].map(theme => ({ language, theme })));

for (const { language, theme } of variants) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    test(`${language} ${theme} installation controls at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText: async text => { window.copiedCommand = text; } },
        });
      });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const file = language === 'en' ? 'docs/index.html' : 'docs/zh/index.html';
      await page.goto(pathToFileURL(path.join(root, file)).href);
      await page.evaluate(value => window.applyTheme(value), theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const panel = page.locator('.install-options');
      await expect(panel).toBeVisible();
      await expect(panel.locator('[data-install-method]')).toHaveCount(4);
      let panelHeight;
      for (const [method, command] of Object.entries(commands)) {
        const button = panel.locator(`[data-install-method="${method}"]`);
        await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await expect(button).toHaveCSS('border-top-style', 'solid');
        await expect(button).toHaveCSS('background-color', 'rgb(245, 158, 11)');
        const selectedColors = await button.evaluate(element => {
          const style = getComputedStyle(element);
          const other = element.parentElement.querySelector('[aria-pressed="false"]');
          return { text: style.color, background: style.backgroundColor, other: getComputedStyle(other).backgroundColor };
        });
        expect(selectedColors.background).not.toBe(selectedColors.other);
        expect(contrastRatio(selectedColors.text, selectedColors.background)).toBeGreaterThanOrEqual(4.5);
        const labelBounds = await button.evaluate(element => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const label = range.getBoundingClientRect();
          const box = element.getBoundingClientRect();
          return { left: label.left, right: label.right, boxLeft: box.left, boxRight: box.right };
        });
        expect(labelBounds.left).toBeGreaterThanOrEqual(labelBounds.boxLeft);
        expect(labelBounds.right).toBeLessThanOrEqual(labelBounds.boxRight);
        await expect(panel.locator('[aria-pressed="true"]')).toHaveCount(1);
        await expect(panel.locator('[data-install-command-text]')).toHaveText(command);
        await expect(panel.locator('.install-copy')).toHaveAttribute('data-copy-command', command);
        await panel.locator('.install-copy').click();
        expect(await page.evaluate(() => window.copiedCommand)).toBe(command);
        const bounds = await panel.boundingBox();
        if (panelHeight === undefined) panelHeight = bounds.height;
        expect(bounds.height).toBeCloseTo(panelHeight, 0);
        const textBounds = await panel.locator('code').boundingBox();
        const copyBounds = await panel.locator('.install-copy').boundingBox();
        expect(textBounds.x + textBounds.width).toBeLessThanOrEqual(copyBounds.x);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      }
      const first = panel.locator('[data-install-method="curl"]');
      await first.focus();
      await first.press('ArrowRight');
      await expect(panel.locator('[data-install-method="powershell"]')).toBeFocused();
      await expect(panel.locator('[data-install-method="powershell"]')).toHaveAttribute('aria-pressed', 'true');
      await page.screenshot({ path: testInfo.outputPath(`install-${language}-${theme}-${viewport.width}.png`) });
      if (language === 'zh' && viewport.width === 1440) {
        const brew = panel.locator('[data-install-method="brew"]');
        await brew.click();
        await page.mouse.move(0, 0);
        await expect(brew).toHaveCSS('background-color', 'rgb(245, 158, 11)');
        await panel.screenshot({ path: testInfo.outputPath(`install-panel-${theme}.png`) });
      }
      expect(errors).toEqual([]);
    });
  }
}

test('switching installation channels discards a pending copy confirmation', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: text => new Promise(resolve => {
        window.finishCopy = () => { window.copiedCommand = text; resolve(); };
      }) },
    });
  });
  await page.goto(pathToFileURL(path.join(root, 'docs/index.html')).href);
  await page.locator('[data-install-method="curl"]').click();
  await page.locator('.install-copy').click();
  await page.locator('[data-install-method="powershell"]').click();
  await page.evaluate(async () => {
    window.finishCopy();
    await new Promise(resolve => requestAnimationFrame(resolve));
  });
  await expect(page.locator('.install-copy')).not.toHaveClass(/is-copied/);
  await expect(page.locator('[data-install-command-text]')).toHaveText(commands.powershell);
});

test('a failed clipboard fallback does not report a successful copy', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async () => { throw new Error('Permission denied'); } },
    });
    document.execCommand = () => { window.fallbackAttempted = true; return false; };
  });
  await page.goto(pathToFileURL(path.join(root, 'docs/index.html')).href);
  await page.locator('.install-copy').click();
  await page.waitForFunction(() => window.fallbackAttempted);
  await expect(page.locator('.install-copy')).not.toHaveClass(/is-copied/);
});
