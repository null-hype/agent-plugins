import { defineConfig } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pkl from './pkl.mjs';

// `playwright test` runs the Question graph on its own, so an editor's run
// button works: a fresh run directory and mock answers unless told otherwise.
// run.mjs sets the same variables for live runs and fixed output directories.
// Workers inherit these and never re-evaluate the source contract.
const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
env.JEV_RUN_ID ||= randomUUID();
env.JEV_RUN_DIR ||= path.join(here, 'runs', env.JEV_RUN_ID);
env.JEV_BACKEND ||= 'mock';
env.JEV_CREDENTIALS ||= 'pass';
env.JEV_CONTRACT ||= path.join(here, 'report-expected.pcf');
env.JEV_MOCK_ANSWERS ||= path.join(here, 'fixtures/answers.json');
env.JEV_SECRET_REF ||= '';
const runDir = env.JEV_RUN_DIR;

let experiment;
if (env.JEV_CONTRACT_SNAPSHOT) {
  experiment = JSON.parse(readFileSync(env.JEV_CONTRACT_SNAPSHOT, 'utf8'));
} else {
  // global-setup.ts writes the snapshot when a run starts, so listing tests
  // (as an editor does to find them) leaves no run directory behind.
  experiment = pkl.load(env.JEV_CONTRACT);
  env.JEV_CONTRACT_SNAPSHOT = path.join(runDir, 'report-expected.json');
}
const contractDigest = createHash('sha256').update(JSON.stringify(experiment)).digest('hex');
const titled = (ask: string) => new RegExp(`(?:^|\\s)${ask.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

export default defineConfig({
  testDir: './tests',
  outputDir: path.join(runDir, 'test-results'),
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  // One project per Question: the test titled with its words, at its revision.
  // `unasked` runs every test no Question asks, and fails it, so a test and the
  // contract cannot drift apart unnoticed.
  projects: [
    ...Object.entries(experiment.questions).map(([id, question]: [string, any]) => ({
      name: id,
      dependencies: question.dependencies,
      grep: titled(question.ask),
      use: { revision: question.revision },
    })),
    { name: 'unasked', grepInvert: Object.values(experiment.questions).map((q: any) => titled(q.ask)) },
  ],
  timeout: 150_000,
  metadata: { experiment, contractDigest, runId: env.JEV_RUN_ID },
  // Order matters: the jev reporter reconciles in its onEnd, after the JSON
  // reporter's onEnd has written the native report (Playwright awaits each
  // reporter's onEnd in this order).
  // Listing tests (as an editor does to find them) runs no reporters of ours.
  reporter: process.argv.includes('--list') ? [['list']] : [
    ['list'],
    ['json', { outputFile: path.join(runDir, 'playwright-report.json') }],
    ['./reporter.ts', { experiment, contractDigest, runDir }],
  ],
});
