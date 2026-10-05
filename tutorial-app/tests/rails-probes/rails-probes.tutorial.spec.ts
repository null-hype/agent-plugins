import { expect, test, type TestInfo } from '@playwright/test';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { REPRODUCTION_DIR, SOLVED_FIXTURE, STARTER_FIXTURE, applyReproduction, committed, readSolvedFixture, serialize, type ProbeName } from './fixture';
import {
  CHECKED_REVISION,
  FORGED_LINE,
  MERGED_EQUIVALENT,
  REPRODUCTION_ID,
  deletedTrace,
  forgedRead,
  loadPinnedChecker,
  pklVersion,
  runChecker,
  type CheckerRun,
} from './probes';

// CIT-307: review 1 of PR 117 said that deleting the retained strace transcript,
// or replacing it with a dummy-file read in the blocked arm, "still left all 28
// assertions passing". This runs both for real against the pinned checker, one
// isolated copy each, and compiles the review-1 lesson from the result: the
// starter and solved traces the Client/Agent previews play, plus the retained
// reproduction files the solution reveals.
//
// Both probes ASSERT THE FLAW: the checker still passes. A passing test is what
// lets the tutorial reporter write lessons (it writes nothing for a failed
// test), so "the check does not notice" is the green outcome here, and the day
// somebody fixes the checker this test goes red and names the probe.
//
// Provenance: this is a NEW run. It reproduces the probes; it does not recover
// the reviewers' own mutation outputs, which the evidence bundle records as
// not retained.

test.skip(pklVersion() === null, 'pkl is not on PATH');

async function attachTutorial(testInfo: TestInfo, index: number, name: string, body: string, contentType = 'text/plain') {
  await testInfo.attach(`tutorial:${index}:${name}`, { body, contentType });
}

const result = (probe: string, run: CheckerRun, what: string) =>
  [
    `reproduction: ${REPRODUCTION_ID}`,
    `probe: ${probe}`,
    `checker: PR 117 at ${CHECKED_REVISION.slice(0, 8)} (same cit-294 tree as ${MERGED_EQUIVALENT.slice(0, 8)} on main)`,
    `mutation: ${what}`,
    `exit code: ${run.exitCode}`,
    run.summary,
    ...run.facts,
    '',
  ].join('\n');

test('Can the check in 117 be trusted', { tag: '@tutorial' }, async ({}, testInfo) => {
  const pinned = loadPinnedChecker();
  const trace = pinned.get('canary-reads.txt')!.toString('utf8');
  const runs = {} as Record<ProbeName, CheckerRun>;
  const reproduction = new Map<string, string>();

  await test.step('Can the check tell a real file read from a forged one', async () => {
    const baseline = runChecker(pinned);
    expect(baseline.exitCode).toBe(0);
    expect([baseline.testsPassed, baseline.testsTotal]).toEqual([12, 12]);
    expect([baseline.assertsPassed, baseline.assertsTotal]).toEqual([28, 28]);
    // The unmodified transcript has no dummy-file read in the blocked arm.
    expect(trace.split('### ARM: ')[2]).not.toContain('dummy-canary.txt');
    reproduction.set('runs/baseline/result.txt', result('none', baseline, 'none (retained evidence as pinned)'));

    // Probe 1. The flaw: the checker never reads the trace, so nothing changes.
    const deleted = deletedTrace(pinned);
    expect(deleted.has('canary-reads.txt')).toBe(false);
    runs['deleted-trace'] = runChecker(deleted);
    expect(runs['deleted-trace'].exitCode).toBe(0);
    expect([runs['deleted-trace'].assertsPassed, runs['deleted-trace'].assertsTotal]).toEqual([28, 28]);
    reproduction.set('probes/deleted-trace/mutation.txt', 'removed: canary-reads.txt (the whole retained strace transcript)\n');
    reproduction.set('probes/deleted-trace/result.txt', result('deleted-trace', runs['deleted-trace'], 'canary-reads.txt removed'));

    // Probe 2: a dummy-file read in the blocked arm, which blocking should prevent.
    const forgedFiles = forgedRead(pinned);
    const forged = forgedFiles.get('canary-reads.txt')!.toString('utf8');
    expect(forged.split('### ARM: ')[2]).toContain('dummy-canary.txt');
    // The only difference from the pinned transcript is the one added line.
    const arms = forged.split('### ARM: ');
    arms[2] = arms[2].replace(`${FORGED_LINE}\n`, '');
    expect(arms.join('### ARM: ')).toBe(trace);
    runs['forged-read'] = runChecker(forgedFiles);
    expect(runs['forged-read'].exitCode).toBe(0);
    expect([runs['forged-read'].assertsPassed, runs['forged-read'].assertsTotal]).toEqual([28, 28]);
    reproduction.set('probes/forged-read/canary-reads.txt', forged);
    reproduction.set('probes/forged-read/mutation.txt', `added to the mat-blocked arm of canary-reads.txt:\n+${FORGED_LINE}\n`);
    reproduction.set('probes/forged-read/result.txt', result('forged-read', runs['forged-read'], 'dummy-file openat added to the mat-blocked arm'));

    // The committed reproduction and the Storybook fixture must say what the
    // checker just did. CIT307_UPDATE=1 rewrites them; otherwise a drift fails.
    const solved = serialize(applyReproduction(readSolvedFixture(), runs));
    const drift: string[] = [];
    for (const [file, body] of reproduction) {
      if (!committed(path.join(REPRODUCTION_DIR, file), body).matches) drift.push(`reproduction/${file}`);
    }
    if (!committed(SOLVED_FIXTURE, solved).matches) drift.push('stories/fixtures/rails-matlab-review-1.solved.json');
    expect(drift, 'committed reproduction differs from this run; rerun with CIT307_UPDATE=1').toEqual([]);

    // The lesson: the Client/Agent trace goes from the starter to the solved
    // fixture, and Solve also reveals the reproduction files.
    await attachTutorial(testInfo, 1, 'before/file/acp-trace.json', readFileSync(STARTER_FIXTURE, 'utf8'), 'application/json');
    await attachTutorial(testInfo, 1, 'file/acp-trace.json', solved, 'application/json');
    for (const [file, body] of reproduction) await attachTutorial(testInfo, 1, `file/reproduction/${file}`, body);
    await attachTutorial(testInfo, 1, 'prose', PROSE, 'text/markdown');
    await attachTutorial(testInfo, 1, 'meta', JSON.stringify(LESSON_META), 'application/json');
  });

  await testInfo.attach('environment.json', {
    body: JSON.stringify({ reproduction: REPRODUCTION_ID, pkl: pklVersion() }, null, 2),
    contentType: 'application/json',
  });
});

test('the harness can fail: a mutation the checker does see is reported', () => {
  const files = new Map(loadPinnedChecker());
  const observed = JSON.parse(files.get('observations/mat-blocked.json')!.toString('utf8'));
  observed.block_untrusted_env = '0';
  files.set('observations/mat-blocked.json', Buffer.from(JSON.stringify(observed, null, 2)));
  const run = runChecker(files);
  expect(run.exitCode).not.toBe(0);
  expect(run.assertsPassed).toBeLessThan(run.assertsTotal);
});


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

const PROSE = `import AcpTraceBridge from '../../../../../components/AcpTraceBridge';

<AcpTraceBridge client:load traceFile="/acp-trace.json" scenario="cit294-review-v1" />

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
`;
