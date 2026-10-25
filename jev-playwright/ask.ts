import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { score } from './score.mjs';

// Each test in tests/ asks one Question, its title the Question's words. Each
// Playwright project is one Question of report-expected.pcf: it runs the test
// with that title at the project's revision. These fixtures look the Question up
// by project, so the test gathers the evidence and the contract says what is
// asked of Jev and expected of the answer.

const experiment = JSON.parse(readFileSync(process.env.JEV_CONTRACT_SNAPSHOT!, 'utf8'));
const runDir = process.env.JEV_RUN_DIR!;

type Fixtures = {
  /** The revision of the app this project asks the Question of. */
  revision: string;
  /** The Question this project asks, from the contract. */
  question: any;
  /** What the Question's prerequisites recorded, by Question id. */
  prerequisites: Record<string, unknown>;
  /** Record `state` as the evidence and put the Question to Jev. */
  ask: (state: Record<string, unknown>) => Promise<void>;
};

export const test = base.extend<Fixtures>({
  revision: ['', { option: true }],
  question: [async ({}, use, testInfo) => {
    const id = testInfo.project.name;
    const question = experiment.questions[id];
    // A test that no Question asks runs only in the `unasked` project.
    if (!question) throw new Error(`No question in the contract asks "${testInfo.title}"`);
    expect(testInfo.title).toBe(question.ask);
    await use({ id, ...question });
  }, { auto: true }],
  prerequisites: async ({ question }, use) => {
    await use(Object.fromEntries(question.dependencies.map((dependency: string) => [dependency,
      JSON.parse(readFileSync(path.join(runDir, 'questions', dependency, 'state.json'), 'utf8')).state])));
  },
  ask: async ({ question }, use, testInfo) => {
    const attach = (name: string, value: unknown) => testInfo.attach(name, {
      body: Buffer.from(JSON.stringify(value)), contentType: 'application/json',
    });
    await use(async (state) => {
      let scored = false;
      try {
        await attach('jev-evidence', { questionId: question.id, state });
        for (const key of question.requiredEvidence) expect(Object.hasOwn(state, key)).toBe(true);
        const result = await score({ id: question.id, question, state, model: experiment.model, runDir });
        await attach('jev-score', { ...result, error: null });
        scored = true;
        // An answer outside its expected range is data (CIT-314): the test still
        // passes, so its dependents run. Only an answer that could not be
        // collected fails it and skips them. Reconcile.pkl judges the range.
        const { min, max } = question.expected;
        const inRange = result.probability >= min && result.probability <= max;
        testInfo.annotations.push({ type: 'outcome', description: inRange ? 'in-range' : `out-of-range: ${result.probability} not in [${min}, ${max}]` });
      } catch (error: any) {
        if (!scored) await attach('jev-score', {
          backend: process.env.JEV_BACKEND, model: null, probability: null,
          error: error.stderr?.toString() || error.message,
        });
        throw error;
      }
    });
  },
});

export { expect };
