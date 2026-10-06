import { test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkConsistency } from '../consistency.mjs';

// CIT-320: the collectors for watchmen.pcf. Each makes a fresh mock run, applies
// the tamper its Question names, and records what the consistency check said.
// The answer is not asserted: "noticed" and "not noticed" are both data. A
// failed test means only that the answer could not be collected.

const { questions } = JSON.parse(readFileSync(process.env.WATCHMEN_SNAPSHOT!, 'utf8'));
const out = process.env.WATCHMEN_OUT!;
const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const first = 'vulnerability-reproduced';
const second = 'exploit-prevented';
const good = { [first]: 0.95, [second]: 0.95, 'legitimate-access-preserved': 0.95 };

const edit = (file: string, change: (value: any) => void) => {
  const value = JSON.parse(readFileSync(file, 'utf8'));
  change(value);
  writeFileSync(file, JSON.stringify(value));
};
const record = (runDir: string, id: string, file: string) => path.join(runDir, 'questions', id, file);

/** Each collector: the canned answers for its run, the tamper, and the backend the check is told was used. */
const collectors: Record<string, { answers?: Record<string, number>; backend?: string; tamper?: (runDir: string) => void }> = {
  untouched: {},
  'low-score': { answers: { ...good, [first]: 0.2 } },
  'forged-score': { tamper: (d) => edit(record(d, first, 'response.json'), (r) => { r.answers[first].noul = 0.5; }) },
  'forged-model': { tamper: (d) => edit(record(d, first, 'response.json'), (r) => { r.model = 'jev-other'; }) },
  'forged-evidence': { tamper: (d) => edit(record(d, second, 'request.json'), (r) => { r.state.http.response.status = 200; }) },
  'leaked-range': { tamper: (d) => edit(record(d, first, 'request.json'), (r) => { r.questions[first].expected = { min: 0.8, max: 1 }; }) },
  'changed-criteria': { tamper: (d) => edit(record(d, first, 'request.json'), (r) => { r.questions[first].criteria = { true: 'anything', false: 'nothing' }; }) },
  'mislabelled-backend': { backend: 'real' },
  'changed-contract': { tamper: (d) => edit(path.join(d, 'report-expected.json'), (c) => { c.questions[first].expected.min = 0.1; }) },
};

for (const [id, question] of Object.entries(questions) as [string, any][]) {
  test(id, async ({}, testInfo) => {
    const collector = collectors[question.collector];
    if (!collector) throw new Error(`Unknown watchmen collector: ${question.collector}`);
    const temp = mkdtempSync(path.join(tmpdir(), 'watchmen-'));
    try {
      const answers = path.join(temp, 'answers.json');
      writeFileSync(answers, JSON.stringify(collector.answers ?? good));
      const runDir = path.join(temp, 'run');
      const run = spawnSync(process.execPath, ['run.mjs', '--mock-answers', answers, '--output-dir', runDir], { cwd: here, encoding: 'utf8', timeout: 60_000 });
      if (!/artifacts: /.test(run.stdout ?? '')) throw new Error(`the run could not be made: ${run.stderr || run.error?.message}`);
      collector.tamper?.(runDir);
      const verdict = checkConsistency(runDir, collector.backend ?? 'mock');
      const answer = { question: question.question, noticed: !verdict.consistent, expectedRule: question.rule ?? null, consistent: verdict.consistent, broken: verdict.broken };
      mkdirSync(path.join(out, id), { recursive: true });
      writeFileSync(path.join(out, id, 'answer.json'), JSON.stringify(answer, null, 2) + '\n');
      await testInfo.attach('watchmen-answer', { body: JSON.stringify(answer), contentType: 'application/json' });
      testInfo.annotations.push({ type: id, description: `${answer.noticed ? 'noticed' : 'not noticed'}: ${verdict.broken.join('; ') || 'consistent'}` });
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
}
