import { expect, test, type TestInfo } from '@playwright/test';
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
// isolated copy each, and compiles the result into lessons.
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

const text = (body: string) => ({ body, contentType: 'text/plain' });
async function attachTutorial(testInfo: TestInfo, index: number, name: string, body: string, contentType = 'text/plain') {
  await testInfo.attach(`tutorial:${index}:${name}`, { body, contentType });
}

/** Declare the whole file state a step starts from (the previous step's end state). */
async function declareBefore(testInfo: TestInfo, index: number, state: Map<string, string>) {
  for (const [file, body] of state) await attachTutorial(testInfo, index, `before/file/${file}`, body);
}
async function declareEnd(testInfo: TestInfo, index: number, state: Map<string, string>, added: Record<string, string>) {
  for (const [file, body] of Object.entries(added)) {
    state.set(file, body);
    await attachTutorial(testInfo, index, `file/${file}`, body);
  }
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

test('Do the probes get past the PR 117 checker', { tag: '@tutorial' }, async ({}, testInfo) => {
  const pinned = loadPinnedChecker();
  const trace = pinned.get('canary-reads.txt')!.toString('utf8');
  const state = new Map<string, string>();

  await test.step('The checker passes on the retained evidence', async () => {
    const baseline = runChecker(pinned);
    expect(baseline.exitCode).toBe(0);
    expect([baseline.testsPassed, baseline.testsTotal]).toEqual([12, 12]);
    expect([baseline.assertsPassed, baseline.assertsTotal]).toEqual([28, 28]);
    // The unmodified transcript has no dummy-file read in the blocked arm.
    expect(trace.split('### ARM: ')[2]).not.toContain('dummy-canary.txt');

    state.set('canary-reads.txt', trace);
    await declareBefore(testInfo, 1, state);
    await attachTutorial(testInfo, 1, 'prose', PROSE[0], 'text/markdown');
    // The reporter's end state is built from file/ attachments alone, so the
    // untouched transcript must be restated or step 2 would start without it.
    await declareEnd(testInfo, 1, state, { 'canary-reads.txt': trace, 'runs/baseline/result.txt': result('none', baseline, 'none (retained evidence as pinned)') });
  });

  await test.step('Delete the retained trace', async () => {
    const files = deletedTrace(pinned);
    expect(files.has('canary-reads.txt')).toBe(false);
    const run = runChecker(files);
    // The flaw: the checker never reads the trace, so nothing changes.
    expect(run.exitCode).toBe(0);
    expect([run.assertsPassed, run.assertsTotal]).toEqual([28, 28]);

    await declareBefore(testInfo, 2, state);
    await attachTutorial(testInfo, 2, 'prose', PROSE[1], 'text/markdown');
    await declareEnd(testInfo, 2, state, {
      'probes/deleted-trace/mutation.txt': 'removed: canary-reads.txt (the whole retained strace transcript)\n',
      'probes/deleted-trace/result.txt': result('deleted-trace', run, 'canary-reads.txt removed'),
    });
  });

  await test.step('Forge a dummy-file read into the blocked arm', async () => {
    const files = forgedRead(pinned);
    const forged = files.get('canary-reads.txt')!.toString('utf8');
    expect(forged.split('### ARM: ')[2]).toContain('dummy-canary.txt');
    // The only difference from the pinned transcript is the one added line.
    const arms = forged.split('### ARM: ');
    arms[2] = arms[2].replace(`${FORGED_LINE}\n`, '');
    expect(arms.join('### ARM: ')).toBe(trace);
    const run = runChecker(files);
    expect(run.exitCode).toBe(0);
    expect([run.assertsPassed, run.assertsTotal]).toEqual([28, 28]);

    await declareBefore(testInfo, 3, state);
    await attachTutorial(testInfo, 3, 'prose', PROSE[2], 'text/markdown');
    await declareEnd(testInfo, 3, state, {
      'probes/forged-read/canary-reads.txt': forged,
      'probes/forged-read/mutation.txt': `added to the mat-blocked arm of canary-reads.txt:\n+${FORGED_LINE}\n`,
      'probes/forged-read/result.txt': result('forged-read', run, 'dummy-file openat added to the mat-blocked arm'),
    });
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

const PROSE = [
  `# Start from a passing checker

**Reproduction \`${REPRODUCTION_ID}\`.** The files here are the retained evidence
from PR 117 (\`${CHECKED_REVISION.slice(0, 8)}\`). \`canary-reads.txt\` is the
\`strace\` transcript of the four arms. The Pkl suite passes: 12 tests, 28
assertions.

The question for the next two steps is the one review 1 asked: **does the check
notice if that transcript is missing or wrong?**

**Evidence scope:** the checker output is real, produced by running \`pkl test\`
on these bytes. It is a new run, not the reviewers' own output; theirs was not
retained.
`,
  `# Delete the trace

\`probes/deleted-trace/\` holds what was done and what the checker said. The
transcript is gone, and the suite still passes all 28 assertions.

Nothing in the Pkl modules reads \`canary-reads.txt\`; the read/no-read evidence
never reaches the checker.
`,
  `# Forge a read

\`probes/forged-read/canary-reads.txt\` is the transcript with a dummy-file read
added to the **blocked** arm, which is exactly what blocking is supposed to
prevent. The suite still passes all 28 assertions.

The checker trusts the observation JSON's own booleans and never consults the
independent evidence.
`,
];
