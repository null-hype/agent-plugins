import { generateReplay } from './tests/rails-probes/generate';
import { defineConfig } from '@playwright/test';

generateReplay();

// A second checkout (a worktree) can run beside one already serving 6006.
const port = Number(process.env.STORYBOOK_PORT || 6006);

export default defineConfig({
  testDir: './tests',
  outputDir: '/tmp/agent-plugins-replay-tests',
  testMatch: ['replay-peek.spec.ts', 'private-file-lessons.spec.ts'],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
  webServer: {
    command: `npx storybook dev -p ${port} --no-open --ci`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
