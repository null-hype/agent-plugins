import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkConsistency } from './consistency.mjs';
import { reconcile } from './reconcile.mjs';
import { writeReportUI } from './report-ui.mjs';

// Scoring belongs to project execution. The reporter records the answers, then
// reconciles them against the contract once the run ends, however the run was
// started: npm test, run.mjs, or an editor's run button.
export default class JevReporter implements Reporter {
  private results = new Map<string, { test: TestCase, result: TestResult }>();
  constructor(private options: any) {}

  onTestEnd(test: TestCase, result: TestResult) {
    this.results.set(test.id, { test, result });
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult['status'] } | void> {
    const { contractDigest, runDir } = this.options;
    const scores: Record<string, unknown> = {};
    for (const { test, result } of this.results.values()) {
      const id = test.parent.project()!.name;
      const attachments = result.attachments.filter(a => a.name === 'jev-score');
      if (attachments.length === 1 && !Object.hasOwn(scores, id)) {
        const attachment = attachments[0];
        scores[id] = JSON.parse((attachment.body ?? readFileSync(attachment.path!)).toString());
      }
    }
    writeFileSync(path.join(runDir, 'scores.json'), JSON.stringify({
      runId: process.env.JEV_RUN_ID, contractDigest, scores,
    }, null, 2) + '\n');

    // An answer could not be collected, or the graph was not respected: the
    // run fails. An answer out of range is data and does not.
    let passed = false;
    try {
      const comparison = reconcile(runDir);
      passed = comparison.passed;
      for (const [id, q] of Object.entries(comparison.questions) as [string, any][]) {
        console.log(`${id}: ${q.probability ?? 'no score'}; ${q.outcome}${q.blockedBy.length ? `; blocked by ${q.blockedBy.join(', ')}` : ''}`);
      }
    } catch (error: any) {
      const message = error.stderr?.toString() || error.message;
      writeFileSync(path.join(runDir, 'validation-error.txt'), message + '\n');
      console.error(message);
    }
    // CIT-320: whether the run agrees with itself, independent of whether it passed.
    try {
      const consistency = checkConsistency(runDir, process.env.JEV_BACKEND);
      console.log(`Consistency: ${consistency.consistent ? 'consistent' : `INCONSISTENT\n  ${consistency.broken.join('\n  ')}`}`);
    } catch (error: any) {
      const message = error.stderr?.toString() || error.message;
      writeFileSync(path.join(runDir, 'consistency-error.txt'), message + '\n');
      console.error(message);
    }
    console.log(`Report: ${writeReportUI(runDir)}`);
    if (!passed && result.status === 'passed') return { status: 'failed' };
  }

  printsToStdio() {
    return false;
  }
}
