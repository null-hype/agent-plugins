import { defineConfig } from '@playwright/test';

// CIT-397: the rendering step of one rails-claims case (tests/rails-claims).
// `RailsClaim` in .dagger/rails_claims.go runs it in a container.
const port = Number(process.env.STORYBOOK_PORT || 6006);

export default defineConfig({
  testDir: './tests/rails-claims',
  outputDir: '/tmp/agent-plugins-rails-claims',
  timeout: 120_000,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true },
  webServer: {
    command: `npx storybook dev -p ${port} --no-open --ci`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
