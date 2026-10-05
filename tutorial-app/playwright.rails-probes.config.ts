import { defineConfig } from '@playwright/test';

// CIT-307: runs the two review-1 probes against the pinned PR 117 checker and
// compiles the result through the tutorial reporter, then drives the real
// review-1 Client/Agent pages with the fixture that run produced.
//
//   npx playwright test --config=playwright.rails-probes.config.ts
//   CIT307_UPDATE=1 npx ...     # rewrite the committed reproduction + fixture
//
// Projects `probes` and `consistency` need only `pkl` (set RAILS_PROBES_NO_SERVERS=1
// to run them without the servers below). Project `editor` needs a browser and the
// acp-trace server (started below on its own ports); it depends on `probes`, so
// it never runs against a fixture the checker no longer supports. The tutorial
// reporter writes the lesson into src/content/tutorial/part-4 (the chapter
// directory is rewritten on every compile; commit what it produces).
const launchOptions = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
  : {};

export default defineConfig({
  testDir: './tests/rails-probes',
  outputDir: '../test-results/rails-probes/artifacts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list'], ['./reporters/tutorial.ts', { outDir: './src/content/tutorial/part-4' }]],
  projects: [
    { name: 'probes', testMatch: 'rails-probes.tutorial.spec.ts' },
    // CIT-320: checks the committed records agree with each other and with a re-run
    // of the checker. Needs only `pkl`, like `probes`.
    { name: 'consistency', testMatch: 'rails-probes.consistency.spec.ts' },
    {
      name: 'editor',
      testMatch: 'rails-probes.editor.spec.ts',
      dependencies: ['probes'],
      use: { baseURL: 'http://127.0.0.1:4383', headless: true, viewport: { width: 1400, height: 900 }, launchOptions },
    },
    {
      // Needs the TutorialKit dev server and network (WebContainer runs npm install).
      name: 'playback',
      testMatch: 'rails-probes.playback.spec.ts',
      dependencies: ['probes'],
      use: { baseURL: 'http://localhost:4321', headless: true, viewport: { width: 1440, height: 900 }, launchOptions, screenshot: 'only-on-failure' },
    },
  ],
  // RAILS_PROBES_NO_SERVERS=1 skips both servers, for runs of `probes` and
  // `consistency` alone (the root Dagger module's RailsProbes).
  webServer: process.env.RAILS_PROBES_NO_SERVERS ? [] : [
    {
      command: 'node src/templates/acp-trace/server.cjs',
      url: 'http://127.0.0.1:4383',
      env: { PORT: '4383', AGENT_PORT: '4384' },
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
