import { test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const experiment = JSON.parse(readFileSync(process.env.JEV_CONTRACT_SNAPSHOT!, 'utf8'));
const collectors: Record<string, () => Promise<Record<string, unknown>>> = {
  'food-description': async () => ({
    'food-description': 'A cooked sausage served in a split bread roll.',
  }),
};

for (const [id, question] of Object.entries(experiment.questions) as [string, any][]) {
  test(id, async ({}, testInfo) => {
    const collect = collectors[question.collector];
    if (!collect) throw new Error(`Unknown evidence collector: ${question.collector}`);
    const state = await collect();
    for (const key of question.requiredEvidence) {
      if (!(key in state)) throw new Error(`Missing required evidence: ${key}`);
    }
    await testInfo.attach('jev-evidence', {
      body: Buffer.from(JSON.stringify({ questionId: id, state })),
      contentType: 'application/json',
    });
  });
}
