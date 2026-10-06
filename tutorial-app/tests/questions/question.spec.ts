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
//
// A Question with a `lesson`, in a part that names a lesson module, also renders
// that lesson from its answer and attaches it for the tutorial reporter, which
// compiles the part's lessons into one chapter once all of them are in.

const OUTCOME = path.join(path.dirname(fileURLToPath(import.meta.url)), 'Outcome.pkl');

test('question', async ({ request }, testInfo) => {
  const { part, id, question, lessonModule } = testInfo.project.metadata as { part: string; id: string; question: any; lessonModule?: string };
  const collector = collectors[question.collector];
  if (!collector) throw new Error(`${id}: unknown collector ${question.collector}`);
  const partDir = path.join(process.env.QUESTIONS_RUN_DIR!, part);
  const answers = await collector(partDir, { id, question, request });
  expect(answers.length, `${id}: the collector returned no answer`).toBeGreaterThan(0);
  for (const { at, answer, evidence } of answers) {
    for (const key of question.requiredEvidence) expect(Object.hasOwn((evidence ?? answer) as object, key), `${id} at ${at}: missing ${key}`).toBe(true);
    const outcome = execFileSync('pkl', ['eval', OUTCOME, '-p', `question=${JSON.stringify(question)}`, '-p', `answer=${JSON.stringify(answer)}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    testInfo.annotations.push({ type: `${id} at ${at}`, description: outcome });
    await testInfo.attach(`answer:${at}`, { body: JSON.stringify({ id, at, answer, outcome }, null, 2), contentType: 'application/json' });
  }
  if (!question.lesson || !lessonModule) return;
  const lesson = JSON.parse(execFileSync('pkl', ['eval', lessonModule, '-p', `run=${partDir}`, '-p', `lesson=${id}`], { encoding: 'utf8' }));
  for (const [kind, prefix] of [['before', 'before/file/'], ['incoming', 'incoming/file/'], ['files', 'file/']]) {
    for (const [file, body] of Object.entries<string>(lesson[kind])) await testInfo.attach(`tutorial:1:${prefix}${file}`, { body });
  }
  await testInfo.attach('tutorial:1:prose', { body: lesson.prose, contentType: 'text/markdown' });
  await testInfo.attach('tutorial:1:meta', { body: JSON.stringify(lesson.meta), contentType: 'application/json' });
});
