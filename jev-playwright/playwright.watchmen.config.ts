import { defineConfig } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as pkl from './pkl.mjs';

// CIT-320: one project per watchmen Question (watchmen.pcf). Each asks the
// consistency check whether it notices one tampered record of a fresh mock run.
// Answers are written to WATCHMEN_OUT/<id>/answer.json and are data either way.
const out = path.resolve(process.env.WATCHMEN_OUT ?? 'runs/watchmen');
mkdirSync(out, { recursive: true });
if (!process.env.WATCHMEN_SNAPSHOT) {
  process.env.WATCHMEN_SNAPSHOT = path.join(out, 'watchmen.json');
  writeFileSync(process.env.WATCHMEN_SNAPSHOT, JSON.stringify(pkl.load(path.resolve('watchmen.pcf')), null, 2) + '\n');
}
process.env.WATCHMEN_OUT = out;
const { questions } = await import(process.env.WATCHMEN_SNAPSHOT, { with: { type: 'json' } }).then((m) => m.default);

export default defineConfig({
  testDir: './watchmen',
  outputDir: path.join(out, 'test-results'),
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 120_000,
  projects: Object.entries(questions).map(([id, question]: [string, any]) => ({
    name: id,
    dependencies: question.dependencies,
    grep: new RegExp(`(?:^|\\s)${id}$`),
  })),
  reporter: [['list'], ['json', { outputFile: path.join(out, 'playwright-report.json') }]],
});
