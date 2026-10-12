import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'replay.spec.ts',
  outputDir: process.env.REPLAY_OUT ?? '/tmp/rails-cases',
  reporter: 'line',
  use: { ...devices['Desktop Chrome'] },
});
