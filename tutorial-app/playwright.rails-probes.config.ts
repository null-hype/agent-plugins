import { defineConfig } from '@playwright/test';

// CIT-307: runs the two review-1 probes against the pinned PR 117 checker and
// compiles the result through the tutorial reporter. No browser, no servers.
//
//   npx playwright test --config=playwright.rails-probes.config.ts
//
// The generated lessons go to test-results/, not into src/content/tutorial:
// promoting them into the course is a separate decision (see
// tests/rails-probes/README.md).
export default defineConfig({
  testDir: './tests/rails-probes',
  testMatch: '*.spec.ts',
  outputDir: '../test-results/rails-probes/artifacts',
  timeout: 60_000,
  workers: 1,
  reporter: [['list'], ['./reporters/tutorial.ts', { outDir: '../test-results/rails-probes/tutorial' }]],
});
