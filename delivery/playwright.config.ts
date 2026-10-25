import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The plan's loop, smallest version: `ask` dispatches one repoless Jules
// session, under a reason Pass records; `retro` finds that reason in the Pass
// monitor log and asks Jev whether it serves the goal (goal.md).
//
//   npx playwright test -c delivery
//
// Needs pass-cli logged in (or JULES_API_KEY), and the harness's .venv for
// Jev. Jev is mock (answers.json) unless JEV_BACKEND=real and JEV_SECRET_REF.
// A session still working fails as not yet: run the plan again later.
const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
env.DELIVERY_LEDGER ||= path.join(here, 'test-results', 'reasons.jsonl');
env.JEV_RUN_ID ||= randomUUID();
env.JEV_BACKEND ||= 'mock';
env.JEV_CREDENTIALS ||= 'pass';
env.JEV_MOCK_ANSWERS ||= path.join(here, 'answers.json');

export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  globalSetup: './global-setup.ts',
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 5 * 60_000,
  projects: [
    { name: 'ask', testMatch: 'ask.spec.ts' },
    { name: 'retro', testMatch: 'retro.spec.ts', dependencies: ['ask'] },
  ],
  reporter: [['list'], ['json', { outputFile: './test-results/report.json' }]],
});
