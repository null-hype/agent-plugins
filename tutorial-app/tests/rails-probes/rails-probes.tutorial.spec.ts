import { expect, test, type TestInfo } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  applyReproduction,
  committed,
  readSolvedFixture,
  reproductionDir,
  serialize,
  solvedFixture,
  starterFixture,
  type ProbeName,
} from './fixture';
import {
  FORGED_LINE,
  REPRODUCTION_ID,
  REVISIONS,
  deletedTrace,
  forgedRead,
  loadPinnedChecker,
  pklVersion,
  runChecker,
  type CheckerRun,
  type RevisionKey,
} from './probes';

// CIT-307 / CIT-309: review 1 of PR 117 said that deleting the retained strace
// transcript, or replacing it with a dummy-file read in the blocked arm, "still
// left all 28 assertions passing". These are the same two questions, asked of
// each checker state in turn with the same mutations: the revision is an input,
// the questions and their wording are not. Each is run for real against the
// pinned checker in its own isolated copy, and each state compiles into one
// lesson of the chapter: the starter and solved traces the Client/Agent
// previews play, plus the retained reproduction files the solution reveals.
//
// The probes ASSERT WHAT THE CHECKER DID, and today that is "still passes" at
// both states (review 2 says the same of PR 118). A passing test is what lets
// the tutorial reporter write lessons (it writes nothing for a failed test),
// so "the check does not notice" is the green outcome here, and the day
// somebody fixes the checker this test goes red and names the revision.
//
// Provenance: each result is a NEW run. It reproduces the probes; it does not
// recover the reviewers' own mutation outputs, which the evidence bundle
// records as not retained.

test.skip(pklVersion() === null, 'pkl is not on PATH');

const ORDER: RevisionKey[] = ['S1', 'S2'];
const TITLES: Record<RevisionKey, string> = {
  S1: 'Can the check tell a real file read from a forged one',
  S2: 'Can the strengthened check tell a real file read from a forged one',
};

async function attachTutorial(testInfo: TestInfo, index: number, name: string, body: string, contentType = 'text/plain') {
  await testInfo.attach(`tutorial:${index}:${name}`, { body, contentType });
}

const result = (key: RevisionKey, probe: string, run: CheckerRun, what: string) =>
  [
    `reproduction: ${REPRODUCTION_ID}`,
    `probe: ${probe}`,
    `checker: PR ${REVISIONS[key].pr} at ${REVISIONS[key].revision.slice(0, 8)} (same cit-294 tree as ${REVISIONS[key].mergedEquivalent.slice(0, 8)} on main)`,
    `mutation: ${what}`,
    `exit code: ${run.exitCode}`,
    run.summary,
    ...run.facts,
    '',
  ].join('\n');

/** Ask both questions of one checker state. Returns the runs and the files that record them. */
function ask(key: RevisionKey) {
  const { baseline: expected } = REVISIONS[key];
  const pinned = loadPinnedChecker(key);
  const trace = pinned.get('canary-reads.txt')!.toString('utf8');
  const runs = {} as Record<ProbeName, CheckerRun>;
  const files = new Map<string, string>();

  const baseline = runChecker(pinned);
  expect(baseline.exitCode).toBe(0);
  expect([baseline.testsPassed, baseline.testsTotal]).toEqual([expected.tests, expected.tests]);
  expect([baseline.assertsPassed, baseline.assertsTotal]).toEqual([expected.asserts, expected.asserts]);
  // The unmodified transcript has no dummy-file read in the blocked arm.
  expect(trace.split('### ARM: ')[2]).not.toContain('dummy-canary.txt');
  files.set('runs/baseline/result.txt', result(key, 'none', baseline, 'none (retained evidence as pinned)'));

  // Question 1. The flaw: nothing reads the trace, so nothing changes.
  const deleted = deletedTrace(pinned);
  expect(deleted.has('canary-reads.txt')).toBe(false);
  runs['deleted-trace'] = runChecker(deleted);
  expect(runs['deleted-trace'].exitCode, `${key}: deleting the trace`).toBe(0);
  expect([runs['deleted-trace'].assertsPassed, runs['deleted-trace'].assertsTotal]).toEqual([expected.asserts, expected.asserts]);
  files.set('probes/deleted-trace/mutation.txt', 'removed: canary-reads.txt (the whole retained strace transcript)\n');
  files.set('probes/deleted-trace/result.txt', result(key, 'deleted-trace', runs['deleted-trace'], 'canary-reads.txt removed'));

  // Question 2: a dummy-file read in the blocked arm, which blocking should prevent.
  const forgedFiles = forgedRead(pinned);
  const forged = forgedFiles.get('canary-reads.txt')!.toString('utf8');
  expect(forged.split('### ARM: ')[2]).toContain('dummy-canary.txt');
  // The only difference from the pinned transcript is the one added line.
  const arms = forged.split('### ARM: ');
  arms[2] = arms[2].replace(`${FORGED_LINE}\n`, '');
  expect(arms.join('### ARM: ')).toBe(trace);
  runs['forged-read'] = runChecker(forgedFiles);
  expect(runs['forged-read'].exitCode, `${key}: forging a read`).toBe(0);
  expect([runs['forged-read'].assertsPassed, runs['forged-read'].assertsTotal]).toEqual([expected.asserts, expected.asserts]);
  files.set('probes/forged-read/canary-reads.txt', forged);
  files.set('probes/forged-read/mutation.txt', `added to the mat-blocked arm of canary-reads.txt:\n+${FORGED_LINE}\n`);
  files.set('probes/forged-read/result.txt', result(key, 'forged-read', runs['forged-read'], 'dummy-file openat added to the mat-blocked arm'));

  // The committed reproduction and the Storybook fixture must say what the
  // checker just did. CIT307_UPDATE=1 rewrites them; otherwise a drift fails.
  const solved = serialize(applyReproduction(key, readSolvedFixture(key), runs));
  const drift: string[] = [];
  for (const [file, body] of files) {
    if (!committed(path.join(reproductionDir(key), file), body).matches) drift.push(`reproduction/${key}/${file}`);
  }
  if (!committed(solvedFixture(key), solved).matches) drift.push(path.relative(path.dirname(solvedFixture(key)), solvedFixture(key)));
  expect(drift, 'committed reproduction differs from this run; rerun with CIT307_UPDATE=1').toEqual([]);

  return { files, solved };
}

test('Can the checker be trusted', { tag: '@tutorial' }, async ({}, testInfo) => {
  // The lesson file state at the end of the previous lesson. Each lesson starts
  // from it with only the trace replaced (the incoming turn), so the reporter's
  // continuity check holds the second lesson to what the first one left.
  let end = new Map<string, string>();

  for (const [i, key] of ORDER.entries()) {
    const index = i + 1;
    await test.step(TITLES[key], async () => {
      const { files, solved } = ask(key);
      const starter = readFileSync(starterFixture(key), 'utf8');

      const before = new Map(end);
      before.set('acp-trace.json', starter);
      if (index > 1) await attachTutorial(testInfo, index, 'incoming/file/acp-trace.json', starter, 'application/json');
      for (const [file, body] of before) await attachTutorial(testInfo, index, `before/file/${file}`, body, file.endsWith('.json') ? 'application/json' : 'text/plain');

      // What Solve leaves: the solved trace and this state's reproduction files.
      const added = new Map<string, string>([['acp-trace.json', solved]]);
      for (const [file, body] of files) added.set(`reproduction/${key}/${file}`, body);
      // The first lesson restates what it leaves untouched: the reporter builds a
      // step's end state from file/ attachments alone, so nothing carries by itself.
      const declared = index === 1 ? new Map([...before, ...added]) : added;
      for (const [file, body] of declared) await attachTutorial(testInfo, index, `file/${file}`, body, file.endsWith('.json') ? 'application/json' : 'text/plain');
      end = new Map([...before, ...added]);

      await attachTutorial(testInfo, index, 'prose', PROSE[key], 'text/markdown');
      await attachTutorial(testInfo, index, 'meta', JSON.stringify(LESSON_META), 'application/json');
    });
  }

  await testInfo.attach('environment.json', {
    body: JSON.stringify({ reproduction: REPRODUCTION_ID, pkl: pklVersion() }, null, 2),
    contentType: 'application/json',
  });
});

for (const key of ORDER) {
  test(`the harness can fail at ${key}: a mutation the checker does see is reported`, () => {
    const files = new Map(loadPinnedChecker(key));
    const observed = JSON.parse(files.get('observations/mat-blocked.json')!.toString('utf8'));
    observed.block_untrusted_env = '0';
    files.set('observations/mat-blocked.json', Buffer.from(JSON.stringify(observed, null, 2)));
    const run = runChecker(files);
    expect(run.exitCode).not.toBe(0);
    expect(run.assertsPassed).toBeLessThan(run.assertsTotal);
  });
}

// The same previews the budget-authority lessons use: Client is the commit-message
// editor, Agent is the reviewer. Solve swaps the starter trace for the solved one.
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

const BRIDGE = `import AcpTraceBridge from '../../../../../components/AcpTraceBridge';

<AcpTraceBridge client:load traceFile="/acp-trace.json" scenario="cit294-review-v1" />
`;

const PROSE: Record<RevisionKey, string> = {
  S1: `${BRIDGE}
# Can the check tell a real file read from a forged one?

Pull request #117 passed its check. The **Client** holds the commit that change
was written as, in the form this case gives every change: a message whose
subject line is a question. Unfold it to read the body.

Select **Solve** to ask the reviewer. Grey suggested lines appear below the
commit: the questions it asked itself to split yours, one by deleting the trace
and one by forging a read. Press **Tab** to accept the one shown, or **Alt+]** to
switch to the other first. You can take either, or both. Each accepted line
becomes text in your editor, and each is checked. The **Agent** shows what the
reviewer was deciding to check, and its finding only after you accept.

Click the lens above an accepted line, **\`review-1.finding-1.deleted-trace\`**
or **\`review-1.finding-1.forged-read\`**, to open the evidence behind it. One row
is the part nobody kept: the output of the review's own test run. Next to it is a
**reproduction**: the same probe run again, for real, against the checker as
submitted. It is a new run, not the reviewers' output, and it shows the checker
still passing all 28 assertions. The files for it appear in the editor after Solve.
`,
  S2: `${BRIDGE}
# Can the strengthened check tell a real file read from a forged one?

Pull request #118 answers the first review. Its description says the
independent read evidence now reaches the checker, and that deleting the trace,
or forging a dummy-file read into the blocked arm, "is now flagged". The
**Client** holds the commit that change was written as.

The two questions are the ones asked of #117, word for word. Select **Solve**
to ask the reviewer, and take either suggestion with **Tab** (or **Alt+]** to
switch first), or both. The **Agent** holds back its finding until you accept.

Open the lens above an accepted line, **\`review-2.finding-1.deleted-trace\`** or
**\`review-2.finding-1.forged-read\`**. The **reproduction** row is the probe run
again, for real, against the checker as #118 submitted it. It is a new run, not
the reviewer's own output, which was not kept. It shows the checker still passing
all 56 assertions. The new tests change the derived open count; neither probe
touches that count, because both change the retained trace. The files for each run
appear in the editor after Solve, beside the first lesson's.
`,
};
