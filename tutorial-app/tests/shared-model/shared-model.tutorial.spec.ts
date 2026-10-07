import { test, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Part 5's "Shared model" chapter: one lesson per revision of the shared model,
// each asked the same Questions (`SharedModel.pkl`), told as a review the way the
// private-document chapter is (`jev.tutorial.spec.ts`). The `shared-model/<id>`
// Question projects asked Pkl; this project depends on them, reads what they
// wrote into the part's run directory and compiles it, asking nothing itself.
// `SharedModelReport.pkl` renders each lesson's traces and prose.
//
// Each revision's file arrives with its commit, as part of the incoming turn, so
// the reporter's continuity check holds every lesson to the one before it plus
// that commit, and nothing else.

const here = path.dirname(fileURLToPath(import.meta.url));
const json = (file: string, expr: string) => JSON.parse(execFileSync('pkl', ['eval', '-x', `new JsonRenderer {}.renderValue(${expr})`, file], { encoding: 'utf8' }));

/** The revisions in lesson order, which must count 1, 2, ... */
const chapter = (): { revision: string; title: string }[] => {
  const revisions: Record<string, { lesson: { order: number; title: string } }> = json(path.join(here, 'SharedModel.pkl'), 'revisions');
  const ordered = Object.entries(revisions).sort(([, a], [, b]) => a.lesson.order - b.lesson.order);
  ordered.forEach(([revision, { lesson }], i) => {
    if (lesson.order !== i + 1) throw new Error(`${revision}: lesson orders in SharedModel.pkl must count 1 to ${ordered.length}`);
  });
  return ordered.map(([revision, { lesson }]) => ({ revision, title: lesson.title }));
};

async function attachTutorial(testInfo: TestInfo, index: number, name: string, body: string) {
  await testInfo.attach(`tutorial:${index}:${name}`, { body, contentType: name.endsWith('.json') ? 'application/json' : 'text/plain' });
}

test('Shared model', { tag: '@tutorial' }, async ({}, testInfo) => {
  const partDir = path.join(process.env.QUESTIONS_RUN_DIR!, 'shared-model');
  let end = new Map<string, string>();

  for (const [i, { revision, title }] of chapter().entries()) {
    const index = i + 1;
    await test.step(title, async () => {
      const lesson = JSON.parse(execFileSync('pkl', ['eval', path.join(here, 'SharedModelReport.pkl'), '-p', `run=${partDir}`, '-p', `revision=${revision}`], { encoding: 'utf8' }));

      // The incoming turn: this revision's commit (its file) and the prompt.
      const incoming = new Map<string, string>([...Object.entries<string>(lesson.incoming), ['acp-trace.json', lesson.starter]]);
      const before = new Map([...end, ...incoming]);
      if (index > 1) for (const [file, body] of incoming) await attachTutorial(testInfo, index, `incoming/file/${file}`, body);
      for (const [file, body] of before) await attachTutorial(testInfo, index, `before/file/${file}`, body);

      // Solve adds Pkl's reply.
      const added = new Map([['acp-trace.json', lesson.solved]]);
      const declared = index === 1 ? new Map([...before, ...added]) : added;
      for (const [file, body] of declared) await attachTutorial(testInfo, index, `file/${file}`, body);
      end = new Map([...before, ...added]);

      await testInfo.attach(`tutorial:${index}:prose`, { body: lesson.prose, contentType: 'text/markdown' });
      await testInfo.attach(`tutorial:${index}:meta`, { body: JSON.stringify(LESSON_META), contentType: 'application/json' });
    });
  }

  await testInfo.attach('environment.json', {
    body: JSON.stringify({ pkl: execFileSync('pkl', ['--version'], { encoding: 'utf8' }).trim() }, null, 2),
    contentType: 'application/json',
  });
});

// As the private-document chapter: the review Client is the only preview, and
// the agent's activity prints to the terminal.
const LESSON_META = {
  template: 'acp-trace',
  prepareCommands: ['npm install'],
  mainCommand: 'npm run dev',
  previews: [[4173, 'Client']],
  editor: false,
  terminal: { open: true, panels: [['output', 'Agent']] },
};
