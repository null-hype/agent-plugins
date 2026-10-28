import type { FullResult, TestCase, TestResult } from '@playwright/test/reporter';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkConsistency } from './consistency.mjs';
import { failureFindings, questionFindings, writeWitnessRun } from './findings.mjs';
import { reconcile } from './reconcile.mjs';
import { writeReportUI } from './report-ui.mjs';
import WitnessReporter from './witness-reporter';

// Scoring belongs to project execution. The reporter records the answers, then
// reconciles them against the contract once the run ends, however the run was
// started: npm test, run.mjs, or an editor's run button.
export default class JevReporter extends WitnessReporter {
  private answers = new Map<string, { test: TestCase, result: TestResult }>();
  constructor(private options: any) { super(); }

  onTestEnd(test: TestCase, result: TestResult) {
    super.onTestEnd(test, result);
    this.answers.set(test.id, { test, result });
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult['status'] } | void> {
    const { contractDigest, runDir } = this.options;
    const scores: Record<string, unknown> = {};
    for (const { test, result } of this.answers.values()) {
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
    let comparison: any = { questions: {} };
    try {
      comparison = reconcile(runDir);
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

    // The run as witness reads it: each question's answer on the test that
    // asked it, and any test no question asks that failed, on its failed step.
    const backends = Object.fromEntries(Object.entries(scores).map(([id, s]: [string, any]) => [id, s?.backend]));
    const asked = new Set(Object.keys(this.options.experiment.questions));
    writeWitnessRun(this.root, [
      ...questionFindings(comparison, backends),
      ...failureFindings(this.root, this.results.filter((r) => !asked.has(r.project))),
    ], runDir);
    if (!passed && result.status === 'passed') return { status: 'failed' };
  }

  printsToStdio() {
    return false;
  }
}
