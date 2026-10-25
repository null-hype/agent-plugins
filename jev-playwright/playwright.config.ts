import { defineConfig } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as pkl from './pkl.mjs';

// run.mjs creates a fresh directory for every execution. Workers inherit the
// snapshot path and never re-evaluate the source contract during the run.
const runDir = process.env.JEV_RUN_DIR;
if (!runDir) throw new Error('Run via npm test or npm run score -- <options>.');
const snapshot = path.join(runDir, 'report-expected.json');
let experiment;
if (process.env.JEV_CONTRACT_SNAPSHOT) {
  experiment = JSON.parse(readFileSync(process.env.JEV_CONTRACT_SNAPSHOT, 'utf8'));
} else {
  experiment = pkl.load(process.env.JEV_CONTRACT || path.resolve('report-expected.pcf'));
  writeFileSync(snapshot, JSON.stringify(experiment, null, 2) + '\n');
  process.env.JEV_CONTRACT_SNAPSHOT = snapshot;
}
const contractDigest = createHash('sha256').update(JSON.stringify(experiment)).digest('hex');
const titled = (ask: string) => new RegExp(`(?:^|\\s)${ask.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

export default defineConfig({
  testDir: './tests',
  outputDir: path.join(runDir, 'test-results'),
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
  metadata: { experiment, contractDigest, runId: process.env.JEV_RUN_ID },
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(runDir, 'playwright-report.json') }],
    ['./reporter.ts', { experiment, contractDigest, runDir }],
  ],
});
