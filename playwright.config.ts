import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Every test talks to the same backend database (staff sessions, reports,
  // walk paths), and some of them change it, so tests run one at a time:
  // a shopper page must never load while another test has a walkway closed.
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results',
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: process.env.TEST_BASE_URL || `http://127.0.0.1:${process.env.PASEO_PORT || 8081}`,
    browserName: 'chromium',
    navigationTimeout: 60_000,
    actionTimeout: 10_000,
    acceptDownloads: true,
    screenshot: 'off',
    video: 'off',
    trace: 'off',
  },
  projects: [
    {
      name: 'desktop',
      testMatch: '**/desktop.spec.ts',
      use: { viewport: { width: 1440, height: 1000 } },
    },
    {
      name: 'mobile',
      testMatch: '**/mobile.spec.ts',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
});