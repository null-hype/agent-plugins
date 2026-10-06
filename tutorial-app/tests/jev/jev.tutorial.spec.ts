import { expect, test, type TestInfo } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// CIT-318: the part-5 lessons, compiled from a real run of the jev-playwright
// Questions. The run's records are committed (`evidence/jev-private-document`);
// the lessons are not. This spec renders each lesson with `JevReport.pkl` from
// those records and attaches it for the tutorial reporter; `npm run build` does
// this first (`scripts/jev-lessons.mjs`). It writes nothing of its own: the trace,
// the lesson text and its settings are the Pkl's, and every score, state and time
// is the run's.
//
// JEV_LESSON_ASK=mock (canned answers) or =real (with JEV_SECRET_REF, as for
// `npm run score`) first asks the Questions again through jev-playwright's own
// Question-driven config (`run.mjs`) and records the new run in place of the old.
// That fails, and records nothing, only when an answer could not be collected or
// the run disagrees with its own records (CIT-320). An answer outside its expected
// range is recorded and told like any other.

const here = path.dirname(fileURLToPath(import.meta.url));
const JEV = path.resolve(here, '../../../jev-playwright');
const MODULE = path.join(here, 'JevReport.pkl');
const RECORDS = path.resolve(here, '../../evidence/jev-private-document');
/** What a lesson is rendered from: the rest of a run directory is not kept. */
const RECORDED = ['comparison.json', 'consistency.json', 'report-expected.json', 'scores.json'];

async function attachTutorial(testInfo: TestInfo, index: number, name: string, body: string, contentType = 'application/json') {
  await testInfo.attach(`tutorial:${index}:${name}`, { body, contentType });
}

/** Every file under `dir`, by its path relative to `dir`. */
const readTree = (dir: string) =>
  new Map(readdirSync(dir).sort().map((file) => [file, readFileSync(path.join(dir, file), 'utf8')] as const));

/** One lesson as `JevReport.pkl` renders it from the run. */
function render(run: string, lesson: string) {
  const out = mkdtempSync(path.join(tmpdir(), 'cit-318-'));
  try {
    execFileSync('pkl', ['eval', '-m', out, MODULE, '-p', `run=${run}`, '-p', `lesson=${lesson}`], { stdio: ['ignore', 'ignore', 'pipe'] });
    return {
      starter: readTree(path.join(out, '_files')),
      solved: readTree(path.join(out, '_solution')),
      prose: readFileSync(path.join(out, 'lesson.md'), 'utf8'),
      meta: readFileSync(path.join(out, 'meta.json'), 'utf8'),
    };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** Asks the Questions again and records the run in RECORDS, in place of the last one. */
async function ask(backend: string, testInfo: TestInfo) {
  const run = path.join(process.env.QUESTIONS_RUN_DIR!, 'jev');
  // A mock run keeps one run ID, so recording it again changes only what the run
  // recorded about itself (its timestamps). A real run gets its own.
  const args = [path.join(JEV, 'run.mjs'), '--backend', backend, '--output-dir', run];
  if (backend === 'mock') args.push('--run-id', 'jev-lessons-mock');
  if (process.env.JEV_SECRET_REF) args.push('--secret-ref', process.env.JEV_SECRET_REF);
  const asked = spawnSync(process.execPath, args, { cwd: JEV, encoding: 'utf8' });
  await testInfo.attach('jev-run.txt', { body: `${asked.stdout}\n${asked.stderr}`, contentType: 'text/plain' });
  expect(asked.status, `the jev Questions could not be answered:\n${asked.stdout}\n${asked.stderr}`).toBe(0);
  const consistency = JSON.parse(readFileSync(path.join(run, 'consistency.json'), 'utf8'));
  expect(consistency.consistent, `the run disagrees with its records: ${consistency.broken?.join('; ')}`).toBe(true);

  rmSync(RECORDS, { recursive: true, force: true });
  for (const file of RECORDED) cpSync(path.join(run, file), path.join(RECORDS, file));
  const ids = Object.keys(JSON.parse(readFileSync(path.join(run, 'comparison.json'), 'utf8')).questions);
  for (const id of ids) cpSync(path.join(run, 'questions', id, 'state.json'), path.join(RECORDS, 'questions', id, 'state.json'));
}

test('Private document', { tag: '@tutorial' }, async ({}, testInfo) => {
  test.setTimeout(300_000);
  const backend = process.env.JEV_LESSON_ASK;
  if (backend) await ask(backend, testInfo);
  const run = RECORDS;
  const consistency = JSON.parse(readFileSync(path.join(run, 'consistency.json'), 'utf8'));
  expect(consistency.consistent, `the recorded run disagrees with its records: ${consistency.broken?.join('; ')}`).toBe(true);

  const chapter: string[] = JSON.parse(
    execFileSync('pkl', ['eval', '-x', 'new JsonRenderer {}.renderValue(chapter)', MODULE, '-p', `run=${run}`], { encoding: 'utf8' }),
  );
  const contract = JSON.parse(readFileSync(path.join(run, 'report-expected.json'), 'utf8'));

  // Each lesson starts where the previous one ended, plus the incoming turn: the
  // next Question's starter trace and its evidence frame.
  let end = new Map<string, string>();
  for (const [i, id] of chapter.entries()) {
    const index = i + 1;
    await test.step(contract.questions[id].lesson.title, async () => {
      const { starter, solved, prose, meta } = render(run, id);
      const incoming = new Map([...starter].filter(([file, body]) => end.get(file) !== body));
      const before = new Map([...end, ...incoming]);
      expect([...before.keys()].sort()).toEqual([...starter.keys()].sort());
      if (index > 1) for (const [file, body] of incoming) await attachTutorial(testInfo, index, `incoming/file/${file}`, body);
      for (const [file, body] of before) await attachTutorial(testInfo, index, `before/file/${file}`, body);

      // The first lesson restates what it leaves untouched: the reporter builds a
      // step's end state from file/ attachments alone.
      const declared = index === 1 ? solved : new Map([...solved].filter(([file, body]) => before.get(file) !== body));
      for (const [file, body] of declared) await attachTutorial(testInfo, index, `file/${file}`, body);
      end = new Map([...before, ...solved]);

      await attachTutorial(testInfo, index, 'prose', prose, 'text/markdown');
      await attachTutorial(testInfo, index, 'meta', meta);
    });
  }
});
