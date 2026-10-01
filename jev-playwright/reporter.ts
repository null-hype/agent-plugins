import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { score } from './score.mjs';

export default class JevReporter implements Reporter {
  private results = new Map<string, { test: TestCase, result: TestResult }>();
  constructor(private options: any) {}

  onTestEnd(test: TestCase, result: TestResult) {
    // Keep the final attempt, while the native JSON report retains all retries.
    this.results.set(test.id, { test, result });
  }

  async onEnd() {
    const { experiment, contractDigest, runDir } = this.options;
    const scores: Record<string, unknown> = {};
    let failed = false;
    for (const { test, result } of this.results.values()) {
      const id = test.title;
      try {
        if (Object.hasOwn(scores, id)) throw new Error(`Duplicate question: ${id}`);
        const question = experiment.questions[id];
        if (!question) throw new Error(`Undeclared question: ${id}`);
        if (result.status !== 'passed') throw new Error(`Evidence test ${result.status}`);
        const attachments = result.attachments.filter(a => a.name === 'jev-evidence');
        if (attachments.length !== 1) throw new Error('Expected exactly one evidence attachment');
        const attachment = attachments[0];
        const evidence = JSON.parse((attachment.body ?? readFileSync(attachment.path!)).toString());
        if (evidence.questionId !== id) throw new Error('Evidence question ID mismatch');
        for (const key of question.requiredEvidence) {
          if (!Object.hasOwn(evidence.state, key)) throw new Error(`Missing evidence: ${key}`);
        }
        scores[id] = { ...(await score({ id, question, state: evidence.state, model: experiment.model, runDir })), error: null };
      } catch (error: any) {
        failed = true;
        const message = error.stderr?.toString() || error.message;
        scores[id] = { backend: process.env.JEV_BACKEND, model: null, probability: null, error: message };
        console.error(`Jev ${id}: ${message}`);
      }
    }
    writeFileSync(path.join(runDir, 'scores.json'), JSON.stringify({
      runId: process.env.JEV_RUN_ID, contractDigest, scores,
    }, null, 2) + '\n');
    if (failed) return { status: 'failed' as const };
  }
}
