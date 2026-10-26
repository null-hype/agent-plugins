import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The first test of the plan: Jules plans the goal (goal.md) without writing
// anything, and Jev judges each step of that plan against the goal and against
// ours. retro then finds every reason the run gave Pass in the Pass monitor
// log, and asks Jev whether each serves the goal.
//
//   npx playwright test -c delivery
//
// Needs pass-cli logged in, with the Jules and TypeSafe keys (JULES_KEY_REF,
// TYPESAFE_KEY_REF). A plan not ready yet fails as not yet: run again later.
const here = path.dirname(fileURLToPath(import.meta.url));
process.env.DELIVERY_LEDGER ||= path.join(here, 'test-results', 'reasons.jsonl');

export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  globalSetup: './global-setup.ts',
  workers: 1,
  retries: 0,
  forbidOnly: true,
  projects: [
    { name: 'plan', testMatch: 'plan.spec.ts' },
    { name: 'retro', testMatch: 'retro.spec.ts', dependencies: ['plan'] },
  ],
  reporter: [['list'], ['json', { outputFile: './test-results/report.json' }]],
});
