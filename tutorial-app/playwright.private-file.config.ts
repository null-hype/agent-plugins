import { defineConfig } from '@playwright/test';

// Part 5's store-backed Storybook walk, without WebContainer.
export default defineConfig({
  testDir: './tests',
  testMatch: 'private-file-walk.spec.ts',
  outputDir: '../test-results/private-file',
  timeout: 60_000,
  expect: { timeout: 10_000 },
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
