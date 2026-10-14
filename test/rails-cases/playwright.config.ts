import { defineConfig, devices } from '@playwright/test';

// The spec's origin is always http://storybook:6006, so a HAR matches in both
// modes; live, Chromium resolves storybook to STORYBOOK_URL's host instead,
// for a container where /etc/hosts is read-only (a container-use env).
const live = process.env.STORYBOOK_URL ? new URL(process.env.STORYBOOK_URL).hostname : undefined;

export default defineConfig({
  testDir: '.',
  testMatch: 'replay.spec.ts',
  outputDir: process.env.REPLAY_OUT ?? '/tmp/rails-cases',
  reporter: 'line',
  use: {
    ...devices['Desktop Chrome'],
    serviceWorkers: 'block',
    launchOptions: { args: live && live !== 'storybook' ? [`--host-resolver-rules=MAP storybook ${live}`] : [] },
  },
});
