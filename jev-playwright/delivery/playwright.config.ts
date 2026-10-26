import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The plan, as Playwright projects:
//   plan   the planner has Jules plan the goal (goal.md), writing nothing
//   judge  the judge, under its own key, has Jev judge that plan
//   audit  the owner, afterwards, in their own session: every agent's reasons,
//          and whether each is still urgent (see audit.spec.ts)
//
//   npx playwright test -c delivery --project plan --project judge
//
// A plan not ready yet fails as not yet: run again later.
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
    { name: 'judge', testMatch: 'judge.spec.ts', dependencies: ['plan'] },
    { name: 'audit', testMatch: 'audit.spec.ts' },
  ],
  reporter: [['list'], ['json', { outputFile: './test-results/report.json' }]],
});
