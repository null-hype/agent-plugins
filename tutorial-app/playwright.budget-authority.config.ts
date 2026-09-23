import { defineConfig } from '@playwright/test';

// CIT-251: compiles and verifies the budget-authority part.
//
//   npx playwright test --config=playwright.budget-authority.config.ts
//
// Project `storyboard` runs tests/budget-authority.tutorial.spec.ts against
// the real acp-trace client page (server.cjs on its own ports, no Astro or
// WebContainer involved) and the tutorial reporter compiles it into
// src/content/tutorial/part-3. Project `playback` then opens those compiled
// lessons in the TutorialKit dev server and plays them with the real
// Solve / Reset / Next controls.
const launchOptions = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
  : {};

export default defineConfig({
  testDir: './tests',
  outputDir: '../test-results/budget-authority',
  timeout: 240_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list'], ['./reporters/tutorial.ts', { outDir: './src/content/tutorial/part-3' }]],
  projects: [
    {
      name: 'storyboard',
      testMatch: 'budget-authority.tutorial.spec.ts',
      // Tall enough that Monaco keeps every log line in its rendered viewport.
      use: { baseURL: 'http://127.0.0.1:4373', headless: true, viewport: { width: 1400, height: 1400 }, launchOptions },
    },
    {
      name: 'playback',
      testMatch: 'budget-authority.playback.spec.ts',
      dependencies: ['storyboard'],
      // A common laptop window: the Client preview is then about a quarter of
      // the screen, which is the size the argument has to read at.
      use: { baseURL: 'http://localhost:4321', headless: true, viewport: { width: 1440, height: 900 }, launchOptions, screenshot: 'only-on-failure' },
    },
  ],
  webServer: [
    {
      command: 'node src/templates/acp-trace/server.cjs',
      url: 'http://127.0.0.1:4373',
      env: { PORT: '4373', AGENT_PORT: '4374' },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1',
      url: 'http://localhost:4321',
      env: { ASTRO_TELEMETRY_DISABLED: '1' },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
