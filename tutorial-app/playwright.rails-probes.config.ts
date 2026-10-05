import { defineConfig } from '@playwright/test';

// CIT-307: runs the two review-1 probes against the pinned PR 117 checker and
// compiles the result through the tutorial reporter, then drives the real
// review-1 Client/Agent pages with the fixture that run produced.
//
//   npx playwright test --config=playwright.rails-probes.config.ts
//   CIT307_UPDATE=1 npx ...     # rewrite the committed reproduction + fixture
//
// Project `probes` needs only `pkl`. Project `editor` needs a browser and the
// acp-trace server (started below on its own ports); it depends on `probes`, so
// it never runs against a fixture the checker no longer supports. The generated
// lessons go to test-results/, not into src/content/tutorial: promoting them
// into the course is a separate decision (tests/rails-probes/README.md).
const launchOptions = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
  : {};

export default defineConfig({
  testDir: './tests/rails-probes',
  outputDir: '../test-results/rails-probes/artifacts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list'], ['./reporters/tutorial.ts', { outDir: '../test-results/rails-probes/tutorial' }]],
  projects: [
    { name: 'probes', testMatch: 'rails-probes.tutorial.spec.ts' },
    {
      name: 'editor',
      testMatch: 'rails-probes.editor.spec.ts',
      dependencies: ['probes'],
      use: { baseURL: 'http://127.0.0.1:4383', headless: true, viewport: { width: 1400, height: 900 }, launchOptions },
    },
  ],
  webServer: {
    command: 'node src/templates/acp-trace/server.cjs',
    url: 'http://127.0.0.1:4383',
    env: { PORT: '4383', AGENT_PORT: '4384' },
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
