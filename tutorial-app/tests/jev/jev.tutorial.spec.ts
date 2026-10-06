import { test, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// CIT-328: part 5's "Private document" chapter, told as a review the way part 4's
// "Can the checker be trusted" is (`rails-probes.tutorial.spec.ts`). Each revision
// of the document app is one lesson, asked the same Questions as the others. The
// `jev/<id>` Question projects ask them (`report-expected.pcf`); this project
// depends on them, reads what they wrote into the part's run directory and
// compiles it, asking nothing itself. `JevReport.pkl` renders each lesson's traces
// and prose; Solve reveals the files each Question collected.

const here = path.dirname(fileURLToPath(import.meta.url));
const contract = path.resolve(here, '../../../jev-playwright/report-expected.pcf');
const lessonModule = path.join(here, 'JevReport.pkl');
const json = (file: string, expr: string) => JSON.parse(execFileSync('pkl', ['eval', '-x', `new JsonRenderer {}.renderValue(${expr})`, file], { encoding: 'utf8' }));

/** The revisions in lesson order, which must count 1, 2, ... */
const chapter = (): { revision: string; title: string }[] => {
  const revisions: Record<string, { lesson: { order: number; title: string } }> = json(contract, 'revisions');
  const ordered = Object.entries(revisions).sort(([, a], [, b]) => a.lesson.order - b.lesson.order);
  ordered.forEach(([revision, { lesson }], i) => {
    if (lesson.order !== i + 1) throw new Error(`${revision}: lesson orders in report-expected.pcf must count 1 to ${ordered.length}`);
  });
  return ordered.map(([revision, { lesson }]) => ({ revision, title: lesson.title }));
};

/** What Solve reveals of each Question: its collected state, and the request and response its answerer saw. */
const REVEALED = ['state.json', 'request.json', 'response.json'];

async function attachTutorial(testInfo: TestInfo, index: number, name: string, body: string, contentType = 'text/plain') {
  await testInfo.attach(`tutorial:${index}:${name}`, { body, contentType });
}

test('Private document', { tag: '@tutorial' }, async ({}, testInfo) => {
  const partDir = path.join(process.env.QUESTIONS_RUN_DIR!, 'jev');
  // As in part 4: each lesson starts from the previous one's end state with only
  // the trace replaced, so the reporter's continuity check holds lesson 2 to it.
  let end = new Map<string, string>();

  for (const [i, { revision, title }] of chapter().entries()) {
    const index = i + 1;
    await test.step(title, async () => {
      const lesson = JSON.parse(execFileSync('pkl', ['eval', lessonModule, '-p', `run=${partDir}`, '-p', `revision=${revision}`], { encoding: 'utf8' }));

      const before = new Map(end);
      before.set('acp-trace.json', lesson.starter);
      if (index > 1) await attachTutorial(testInfo, index, 'incoming/file/acp-trace.json', lesson.starter, 'application/json');
      for (const [file, body] of before) await attachTutorial(testInfo, index, `before/file/${file}`, body, 'application/json');

      const added = new Map<string, string>([['acp-trace.json', lesson.solved]]);
      for (const id of lesson.ids as string[]) {
        for (const file of REVEALED) added.set(`questions/${id}/${file}`, readFileSync(path.join(partDir, 'questions', id, file), 'utf8'));
      }
      // The first lesson restates what it leaves untouched: the reporter builds a
      // step's end state from file/ attachments alone.
      const declared = index === 1 ? new Map([...before, ...added]) : added;
      for (const [file, body] of declared) await attachTutorial(testInfo, index, `file/${file}`, body, 'application/json');
      end = new Map([...before, ...added]);

      await attachTutorial(testInfo, index, 'prose', lesson.prose, 'text/markdown');
      await attachTutorial(testInfo, index, 'meta', JSON.stringify(LESSON_META), 'application/json');
    });
  }
});

// The rails probes' review previews: Client is the commit-message editor, Agent is the reviewer.
const LESSON_META = {
  template: 'acp-trace',
  prepareCommands: ['npm install'],
  mainCommand: 'npm run dev',
  previews: [
    [4173, 'Client'],
    [4174, 'Agent'],
  ],
  editor: true,
  terminal: false,
};
