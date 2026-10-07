import { expect, test, type TestInfo } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  answerJson,
  answerText,
  chapter,
  committed,
  renderTraces,
  reproductionDir,
  solvedFixture,
  starterFixture,
} from './fixture';
import { REPRODUCTION_ID, REVISIONS, loadPinnedChecker, noticed, pklVersion, runChecker, type RevisionKey } from './probes';
import { EVALUATION_SPECS, evaluationIdOf } from '../../src/lib/reviewHistory';

// CIT-307 / CIT-309: review 1 of PR 117 said that deleting the retained strace
// transcript, or replacing it with a dummy-file read in the blocked arm, "still
// left all 28 assertions passing". These are the same two questions, asked of
// each checker state in turn with the same mutations: the revision is an input,
// the questions and their wording are not. Each state compiles into one lesson
// of the chapter: the starter and solved traces the Client/Agent previews play,
// plus the retained reproduction files the solution reveals.
//
// CIT-317: the questions are asked elsewhere. Each is a Question in
// `traces/CheckerProbes.pkl`, run as its own Playwright project by the generic
// `tests/questions/question.spec.ts` through the collector it names
// (`collectors.ts`), which writes what the checker did into the run directory.
// This lesson project depends on those projects and reads that directory: it
// compiles the run, and asks nothing itself. Today the recorded answer is
// "still passes" at both states (review 2 says the same of PR 118), and the
// committed reproduction says so. If a checker catches a probe, the run records
// that, the committed reproduction for it is missing until `CIT307_UPDATE=1`
// writes it, and the lesson says what was observed. The `block_untrusted_env`
// test below is the control: it shows the harness can see a difference when
// there is one.
//
// Provenance: each result is a NEW run. It reproduces the probes; it does not
// recover the reviewers' own mutation outputs, which the evidence bundle
// records as not retained.

// CIT-316: each lesson's title, place and prose are authored in
// `traces/CheckerProbes.pkl`, beside the questions they tell.
const CHAPTER = chapter();
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function attachTutorial(testInfo: TestInfo, index: number, name: string, body: string, contentType = 'text/plain') {
  await testInfo.attach(`tutorial:${index}:${name}`, { body, contentType });
}

/** Every file under `dir`, by its path relative to `dir`, in a stable order. */
const readTree = (dir: string) =>
  new Map(
    (readdirSync(dir, { recursive: true, withFileTypes: true }) as import('node:fs').Dirent[])
      .filter((e) => e.isFile())
      .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
      .sort()
      .map((file) => [file, readFileSync(path.join(dir, file), 'utf8')] as const),
  );

/** One checker state as the Question projects recorded it. Returns the files that record the run, and its traces. */
function compile(key: RevisionKey) {
  const run = readTree(path.join(process.env.QUESTIONS_RUN_DIR!, 'rails-probes', key));
  // The runner's answers: committed beside the reproduction and read by the
  // Pkl-authored traces (CIT-312), but not copied into the lesson.
  const answers = new Map([...run].filter(([file]) => path.basename(file) === 'answer.json'));
  const files = new Map([...run].filter(([file]) => !answers.has(file)));

  // Both traces render from the state's claims and this run's answers (CIT-312).
  const { starter, solved, prose } = renderTraces(key, answers);

  // CIT-313: the finding is the recorded history's, under its id and in its words.
  const finding = EVALUATION_SPECS.find(({ id }) => id === REVISIONS[key].findingId);
  expect(finding, `${REVISIONS[key].findingId} is not a finding in the review history`).toBeDefined();
  const { diagnostic } = JSON.parse(solved).frames[1].envelope.result._meta;
  expect(diagnostic).toMatchObject({ code: finding!.code, message: `${finding!.code}: ${finding!.message}`, evaluationId: evaluationIdOf(finding!.id) });

  // The committed reproduction and the Storybook fixtures must say what the
  // checker just did. CIT307_UPDATE=1 rewrites them; otherwise a drift fails.
  const drift: string[] = [];
  for (const [file, body] of run) {
    if (!committed(path.join(reproductionDir(key), file), body).matches) drift.push(`reproduction/${key}/${file}`);
  }
  for (const [file, body] of [[starterFixture(key), starter], [solvedFixture(key), solved]]) if (!committed(file, body).matches) drift.push(path.basename(file));
  expect(drift, 'committed reproduction differs from this run; rerun with CIT307_UPDATE=1').toEqual([]);

  return { files, starter, solved, prose };
}

test('Can an upload read a private file', { tag: '@tutorial' }, async ({}, testInfo) => {
  // The lesson file state at the end of the previous lesson. Each lesson starts
  // from it with only the trace replaced (the incoming turn), so the reporter's
  // continuity check holds the second lesson to what the first one left.
  let end = new Map<string, string>();

  for (const [i, { key, title }] of CHAPTER.entries()) {
    const index = i + 1;
    await test.step(title, async () => {
      const { files, starter, solved, prose } = compile(key);

      const before = new Map(end);
      before.set('acp-trace.json', starter);
      if (index > 1) await attachTutorial(testInfo, index, 'incoming/file/acp-trace.json', starter, 'application/json');
      for (const [file, body] of before) await attachTutorial(testInfo, index, `before/file/${file}`, body, file.endsWith('.json') ? 'application/json' : 'text/plain');

      // What Solve leaves: the solved trace and this state's reproduction files.
      const added = new Map<string, string>([['acp-trace.json', solved]]);
      for (const [file, body] of files) added.set(`reproduction/${key}/${file}`, body);
      // The review's own words, which the trace's rows cite, as files the lens opens.
      for (const uri of new Set([...solved.matchAll(/"uri": "(evidence\/cit-294-review-history-v1\/captures\/[^"#]+)"/g)].map((m) => m[1]))) {
        added.set(uri, readFileSync(path.join(APP_DIR, uri), 'utf8'));
      }
      // The first lesson restates what it leaves untouched: the reporter builds a
      // step's end state from file/ attachments alone, so nothing carries by itself.
      const declared = index === 1 ? new Map([...before, ...added]) : added;
      for (const [file, body] of declared) await attachTutorial(testInfo, index, `file/${file}`, body, file.endsWith('.json') ? 'application/json' : 'text/plain');
      end = new Map([...before, ...added]);

      await attachTutorial(testInfo, index, 'prose', `${BRIDGE}\n${prose}`, 'text/markdown');
      await attachTutorial(testInfo, index, 'meta', JSON.stringify(LESSON_META), 'application/json');
    });
  }

  await testInfo.attach('environment.json', {
    body: JSON.stringify({ reproduction: REPRODUCTION_ID, pkl: pklVersion() }, null, 2),
    contentType: 'application/json',
  });
});

for (const { key } of CHAPTER) {
  test(`the harness can fail at ${key}: a mutation the checker does see is reported`, () => {
    const files = new Map(loadPinnedChecker(key));
    const observed = JSON.parse(files.get('observations/mat-blocked.json')!.toString('utf8'));
    observed.block_untrusted_env = '0';
    files.set('observations/mat-blocked.json', Buffer.from(JSON.stringify(observed, null, 2)));
    const run = runChecker(files);
    expect(run.exitCode).not.toBe(0);
    expect(run.assertsPassed).toBeLessThan(run.assertsTotal!);
    // And a "noticed" answer is written up as data, not rejected: the fixture says what failed.
    expect(noticed(run)).toBe(true);
    const messages = renderTraces(key, new Map((['forged-read', 'deleted-trace', 'generic-crash', 'emptied-bytes', 'corrupted-pixels', 'swapped-source', 'changed-config', 'prose-mention', 'failed-open', 'other-directory'] as const).map((probe) => [`probes/${probe}/answer.json`, answerJson(run)]))).solved;
    expect(messages).toContain(answerText('deleted-trace', run));
    expect(messages).toContain(`${run.assertsPassed} of ${run.assertsTotal} assertions pass`);
    expect(messages).not.toContain(`Deleting the trace still left all ${run.assertsTotal} assertions passing.`);
  });
}

// Part 5's layout: the Client (the commit-message editor) is the only preview,
// and the reviewer's activity prints to the terminal. Solve swaps the starter
// trace for the solved one.
const LESSON_META = {
  template: 'acp-trace',
  prepareCommands: ['npm install'],
  mainCommand: 'npm run dev',
  previews: [[4173, 'Client']],
  editor: false,
  terminal: { open: true, panels: [['output', 'Agent']] },
};

const BRIDGE = `import AcpTraceBridge from '../../../../../components/AcpTraceBridge';

<AcpTraceBridge client:load traceFile="/acp-trace.json" scenario="cit294-review-v1" />
`;
