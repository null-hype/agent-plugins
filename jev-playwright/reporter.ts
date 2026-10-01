import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Scoring belongs to project execution. The reporter only records outcomes.
export default class JevReporter implements Reporter {
  private results = new Map<string, { test: TestCase, result: TestResult }>();
  constructor(private options: any) {}

  onTestEnd(test: TestCase, result: TestResult) {
    this.results.set(test.id, { test, result });
  }

  onEnd() {
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
  }
}
