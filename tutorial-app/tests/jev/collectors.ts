import { expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Collector } from '../questions/collectors';
// @ts-ignore -- plain ESM, no types
import { score } from '../../../jev-playwright/score.mjs';
import { collectors as evidence } from '../../../jev-playwright/collectors';

// CIT-318: the collectors the jev-playwright Questions (`report-expected.pcf`)
// name. Each collects its evidence against the local document fixture, checks it
// as jev-playwright does, and has it scored by `score.mjs` (a canned mock answer
// unless JEV_BACKEND=real), which writes `questions/<id>/` in the part's run
// directory. The answer is the score; `answer.json` records who gave it.

const here = path.dirname(fileURLToPath(import.meta.url));
const contract = path.resolve(here, '../../../jev-playwright/report-expected.pcf');

const ask = (name: keyof typeof evidence): Collector => async (partDir, { id, question, request }) => {
  const prerequisites = Object.fromEntries(question.dependencies.map((dependency: string) => [dependency,
    JSON.parse(readFileSync(path.join(partDir, 'questions', dependency, 'state.json'), 'utf8')).state]));
  const state = { ...(await evidence[name].collect(request as any, question)), prerequisites };
  evidence[name].verify(state, expect);
  const model = execFileSync('pkl', ['eval', '-x', 'model', contract], { encoding: 'utf8' }).trim();
  const result = await score({ id, question, state, model, runDir: partDir });
  writeFileSync(path.join(partDir, 'questions', id, 'answer.json'),
    JSON.stringify({ runId: process.env.JEV_RUN_ID, ...result, finishedAt: Date.now() }, null, 2) + '\n');
  return [{ at: state.revision, answer: result.probability, evidence: state }];
};

export const jev: Record<string, Collector> = Object.fromEntries(
  (Object.keys(evidence) as (keyof typeof evidence)[]).map((name) => [name, ask(name)]),
);
