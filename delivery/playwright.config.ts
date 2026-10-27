import { defineConfig } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The plan, as Playwright projects:
//   plan   the planner has Jules plan the goal (goal.md), writing nothing
//   judge  the judge, under its own key, has Jev judge that plan
//   build  the planner approves the plan and keeps the patch Jules makes
//   audit  the owner, afterwards, in their own session: every agent's reasons,
//          and whether each is still urgent (see audit.spec.ts)
//
//   npx playwright test -c delivery --project plan --project judge --project build
//
// A node can stop at Jules's plan, for a report in minutes:
//
//   npx playwright test -c delivery --project feature-plan
//
// A plan or a patch not ready yet fails as not yet: run again later.
const here = path.dirname(fileURLToPath(import.meta.url));
process.env.DELIVERY_LEDGER ||= path.join(here, 'test-results', 'reasons.jsonl');

export default defineConfig({
  metadata: { goal: readFileSync(path.join(here, 'goal.md'), 'utf8').trim() },
  testDir: '.',
  outputDir: './test-results',
  globalSetup: './global-setup.ts',
  workers: 1,
  retries: 0,
  forbidOnly: true,
  projects: [
    { name: 'plan', testMatch: 'plan.spec.ts' },
    { name: 'judge', testMatch: 'judge.spec.ts', dependencies: ['plan'] },
    { name: 'build', testMatch: 'build.spec.ts', dependencies: ['judge'] },
    // Nodes of our plan, each a project of hunks.
    { name: 'feature', testMatch: 'feature.spec.ts' },
    { name: 'feature-plan', testMatch: 'feature.spec.ts', metadata: { planOnly: true } },
    { name: 'audit', testMatch: 'audit.spec.ts' },
  ],
  // In CI, failures also become check annotations.
  reporter: [['list'], ['json', { outputFile: './test-results/report.json' }], ['../witness-reporter.ts'], ['./priority-reporter.ts'], ...(process.env.CI ? [['github'] as const] : [])],
});
