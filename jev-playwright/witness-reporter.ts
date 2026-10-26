import type { FullConfig, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import path from 'node:path';
import { failureFindings, writeWitnessRun } from './findings.mjs';

// Any Playwright project's failures as a witness run: each failed test on its
// deepest failed step, in .witness/run/ beside the config.
export default class WitnessReporter implements Reporter {
  protected root = '';
  protected results: { test: TestCase, result: TestResult, project: string }[] = [];

  onBegin(config: FullConfig) {
    this.root = path.dirname(config.configFile ?? config.rootDir);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.results.push({ test, result, project: test.parent.project()?.name ?? '' });
  }

  async onEnd() {
    writeWitnessRun(this.root, failureFindings(this.root, this.results), this.root);
  }

  printsToStdio() {
    return false;
  }
}
