import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectors } from './collectors';

// CIT-317: the one spec every Question project runs. The project (generated in
// `playwright.questions.config.ts` from the part's Pkl Questions) carries its
// Question; this runs the collector the Question names and records where each
// answer stands. An out-of-range answer is data: it is annotated, the project
// passes and its dependents run. Only an answer that could not be collected (the
// collector throws, or required evidence is missing) fails the project, which
// skips its dependents.

const OUTCOME = path.join(path.dirname(fileURLToPath(import.meta.url)), 'Outcome.pkl');

test('question', async ({}, testInfo) => {
  const { part, id, question } = testInfo.project.metadata as { part: string; id: string; question: any };
  const collector = collectors[question.collector];
  if (!collector) throw new Error(`${id}: unknown collector ${question.collector}`);
  const answers = await collector(path.join(process.env.QUESTIONS_RUN_DIR!, part));
  expect(answers.length, `${id}: the collector returned no answer`).toBeGreaterThan(0);
  for (const { at, answer } of answers) {
    for (const key of question.requiredEvidence) expect(Object.hasOwn(answer as object, key), `${id} at ${at}: missing ${key}`).toBe(true);
    const outcome = execFileSync('pkl', ['eval', OUTCOME, '-p', `question=${JSON.stringify(question)}`, '-p', `answer=${JSON.stringify(answer)}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    testInfo.annotations.push({ type: `${id} at ${at}`, description: outcome });
    await testInfo.attach(`answer:${at}`, { body: JSON.stringify({ id, at, answer, outcome }, null, 2), contentType: 'application/json' });
  }
});
