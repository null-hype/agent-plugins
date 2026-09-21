import { defineConfig } from '@playwright/test';

// CIT-235 spike: compiles tests/area51-booking.spec.ts (the one
// `@tutorial`-tagged test) into TutorialKit lessons under
// src/content/tutorial/part-2, via reporters/tutorial.ts. Separate from
// playwright.config.ts (loanword-feedback.spec.ts against the Astro dev
// server) because this run drives Storybook's iframe.html directly -- no
// Astro app involved, no live network either way.
export default defineConfig({
  testDir: './tests',
  testMatch: 'area51-booking.spec.ts',
  outputDir: '../test-results/tutorial-compile',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  workers: 1,
  reporter: [['list'], ['./reporters/tutorial.ts', { outDir: './src/content/tutorial/part-2' }]],
  use: {
    baseURL: 'http://localhost:6006',
    headless: true,
    viewport: { width: 560, height: 460 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
    screenshot: 'off',
    trace: 'off',
  },
  webServer: {
    command: 'npm run storybook -- --ci --quiet',
    url: 'http://localhost:6006',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
