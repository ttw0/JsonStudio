import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'installer-website.spec.js',
  workers: 1,
  timeout: 30_000,
  reporter: 'line',
  use: {
    browserName: 'chromium',
    screenshot: 'only-on-failure',
  },
});
