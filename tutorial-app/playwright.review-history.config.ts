import { defineConfig } from '@playwright/test';

// CIT-306: the review-history acceptance target. Kept apart from
// playwright.debugger.config.ts (CIT-299's) so the shared contract's own target
// is untouched. Same harness: Storybook on 6006, opt-in, one worker.
export default defineConfig({
  testDir: './tests',
  testMatch: 'review-history.acceptance.spec.ts',
  outputDir: '../test-results/review-history',
  timeout: 180_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:6006',
    headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run storybook -- --host 127.0.0.1 --no-open',
    url: 'http://127.0.0.1:6006',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
