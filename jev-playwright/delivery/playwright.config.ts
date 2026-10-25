import { defineConfig } from '@playwright/test';

// The delivery plan: one project per step, in order. A step's test is a
// Question about the product; its fixture asks Jules for the work, repoless.
// Running the plan again picks up sessions it already started.
//
//   npx playwright test -c delivery
//
// Needs pass-cli logged in (or JULES_API_KEY), Go, Neovim 0.11+, pkl, and the
// harness's .venv. DELIVERY_FILES=<dir> checks a package from disk instead.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  testIgnore: 'fresh-project/**',
  outputDir: './test-results',
  workers: 1,
  retries: 0,
  forbidOnly: true,
  projects: [
    { name: 'package', testMatch: 'package.spec.ts' },
  ],
  reporter: [['list'], ['json', { outputFile: './test-results/report.json' }]],
});
