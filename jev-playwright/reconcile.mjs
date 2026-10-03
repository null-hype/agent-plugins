import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as pkl from './pkl.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = filename => JSON.parse(readFileSync(filename, 'utf8'));

export function reconcile(runDir) {
  const expected = read(path.join(runDir, 'report-expected.json'));
  const report = read(path.join(runDir, 'playwright-report.json'));
  const ledger = read(path.join(runDir, 'scores.json'));
  const digest = createHash('sha256').update(JSON.stringify(expected)).digest('hex');
  if (digest !== ledger.contractDigest || digest !== report.config.metadata.contractDigest ||
      ledger.runId !== report.config.metadata.runId) throw new Error('Run/contract identity mismatch');

  const executions = [];
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        const result = test.results.at(-1);
        const attachments = result?.attachments.filter(a => a.name === 'jev-evidence') ?? [];
        let evidenceKeys = [], evidenceId = null;
        if (attachments.length === 1) {
          const a = attachments[0];
          const evidence = JSON.parse(a.body
            ? Buffer.from(a.body, 'base64').toString('utf8')
            : readFileSync(a.path, 'utf8'));
          evidenceId = evidence.questionId;
          evidenceKeys = Object.keys(evidence.state);
        }
        const startedAt = result ? Date.parse(result.startTime) : null;
        executions.push({ questionId: test.projectName, testTitle: spec.title,
          status: result?.status ?? (test.status === 'skipped' ? 'skipped' : 'missing'),
          startedAt, finishedAt: result ? startedAt + result.duration : null,
          evidenceId, evidenceKeys, attachmentCount: attachments.length });
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of report.suites) visit(suite);
  const observed = { ...ledger, executions, runnerErrors: report.errors.length };
  writeFileSync(path.join(runDir, 'report-observed.json'), JSON.stringify(observed, null, 2) + '\n');
  const comparison = pkl.load(path.join(here, 'pkl/Reconcile.pkl'), {
    'expected': pathToFileURL(path.join(runDir, 'report-expected.json')).href,
    'observed': pathToFileURL(path.join(runDir, 'report-observed.json')).href,
  });
  writeFileSync(path.join(runDir, 'comparison.json'), JSON.stringify(comparison, null, 2) + '\n');
  return comparison;
}
