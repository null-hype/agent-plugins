import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { collectors } from '../collectors';
import { score } from '../score.mjs';

const experiment = JSON.parse(readFileSync(process.env.JEV_CONTRACT_SNAPSHOT!, 'utf8'));
const runDir = process.env.JEV_RUN_DIR!;

for (const [id, question] of Object.entries(experiment.questions) as [string, any][]) {
  test(id, async ({ request }, testInfo) => {
    const attach = (name: string, value: unknown) => testInfo.attach(name, {
      body: Buffer.from(JSON.stringify(value)), contentType: 'application/json',
    });
    let scored = false;
    try {
      expect(testInfo.project.name).toBe(id);
      const collector = collectors[question.collector as keyof typeof collectors];
      if (!collector) throw new Error(`Unknown evidence collector: ${question.collector}`);
      const prerequisites = Object.fromEntries(question.dependencies.map((dependency: string) => [dependency,
        JSON.parse(readFileSync(path.join(runDir, 'questions', dependency, 'state.json'), 'utf8')).state]));
      const state = { ...(await collector.collect(request)), prerequisites };
      await attach('jev-evidence', { questionId: id, state });
      for (const key of question.requiredEvidence) expect(Object.hasOwn(state, key)).toBe(true);
      collector.verify(state);
      const result = await score({ id, question, state, model: experiment.model, runDir });
      await attach('jev-score', { ...result, error: null });
      scored = true;
      // Assert before completing this project, so Playwright gates dependents.
      expect(result.probability, 'Jev probability below expected range').toBeGreaterThanOrEqual(question.expected.min);
      expect(result.probability, 'Jev probability above expected range').toBeLessThanOrEqual(question.expected.max);
    } catch (error: any) {
      if (!scored) await attach('jev-score', {
        backend: process.env.JEV_BACKEND, model: null, probability: null,
        error: error.stderr?.toString() || error.message,
      });
      throw error;
    }
  });
}
