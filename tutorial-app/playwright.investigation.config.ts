import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/investigation',
  timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:6017', screenshot: 'only-on-failure' },
  webServer: {
    command: 'python3 -m http.server 6017 --bind 127.0.0.1 --directory storybook-static',
    url: 'http://127.0.0.1:6017',
    reuseExistingServer: !process.env.CI,
  },
});
