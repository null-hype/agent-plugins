import { defineConfig, devices } from '@playwright/test';

// Default: fresh, logged-out contexts against production. PR CI explicitly
// sets LAUNCH_BASE_URL to the locally built site; that is not live evidence.
const baseURL = process.env.LAUNCH_BASE_URL ?? 'https://null-hype.tidelands.dev';
const local = new URL(baseURL).hostname === '127.0.0.1' || new URL(baseURL).hostname === 'localhost';
const proxyURL = process.env.PLAYWRIGHT_PROXY_SERVER ? new URL(process.env.PLAYWRIGHT_PROXY_SERVER) : null;

export default defineConfig({
  testDir: './tests',
  testMatch: 'launch.smoke.spec.ts',
  outputDir: '../test-results/launch',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: '../playwright-report/launch', open: 'never' }]],
  use: {
    baseURL,
    proxy: proxyURL ? {
      server: `${proxyURL.protocol}//${proxyURL.host}`,
      username: proxyURL.username ? decodeURIComponent(proxyURL.username) : undefined,
      password: proxyURL.password ? decodeURIComponent(proxyURL.password) : undefined,
      bypass: '127.0.0.1,localhost',
    } : undefined,
    storageState: { cookies: [], origins: [] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: local ? {
    command: 'npm run preview -- --host 127.0.0.1',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  } : undefined,
});
