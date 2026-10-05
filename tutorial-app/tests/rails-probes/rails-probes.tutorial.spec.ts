import { expect, test, type TestInfo } from '@playwright/test';
import path from 'node:path';
import {
  answerJson,
  answerText,
  chapter,
  committed,
  renderTraces,
  reproductionDir,
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
  noticed,
  pklVersion,
  runChecker,
  type CheckerRun,
  type RevisionKey,
} from './probes';
import { EVALUATION_SPECS, evaluationIdOf } from '../../src/lib/reviewHistory';

// CIT-307 / CIT-309: review 1 of PR 117 said that deleting the retained strace
// transcript, or replacing it with a dummy-file read in the blocked arm, "still
// left all 28 assertions passing". These are the same two questions, asked of
// each checker state in turn with the same mutations: the revision is an input,
// the questions and their wording are not. Each is run for real against the
// pinned checker in its own isolated copy, and each state compiles into one
// lesson of the chapter: the starter and solved traces the Client/Agent
// previews play, plus the retained reproduction files the solution reveals.
//
// The probes RECORD WHAT THE CHECKER DID (CIT-311). Either answer is data: "it
// still passes" and "it now fails" are both written up, and both produce a
// lesson. A failed test means only that the answer could not be collected: the
// pinned inputs do not hash, the baseline does not pass, a mutation does not
// apply, or `pkl test` exits cleanly without a readable summary. Today the
// recorded answer is "still passes" at both states (review 2 says the same of
// PR 118), and the committed reproduction says so. The inputs are pinned by blob
// id, so a fix to the checker cannot change these runs: only adding a revision
// can. If its checker catches a probe, the run reports that, the committed
// reproduction for it is missing until `CIT307_UPDATE=1` writes it, and the
// lesson says what was observed. The `block_untrusted_env` test below is the
// control: it shows the harness can see a difference when there is one.
//
// Provenance: each result is a NEW run. It reproduces the probes; it does not
// recover the reviewers' own mutation outputs, which the evidence bundle
// records as not retained.

test.skip(pklVersion() === null, 'pkl is not on PATH');

// CIT-316: each lesson's title, place and prose are authored in
// `traces/CheckerProbes.pkl`, beside the questions they tell.
const CHAPTER = pklVersion() === null ? [] : chapter();

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
  // The runner's answers, by path under the reproduction: committed beside it and
  // read by the Pkl-authored traces (CIT-312), but not copied into the lesson.
  const answers = new Map<string, string>();

  // The baseline is a precondition, not an answer: a checker that does not pass
  // as retained leaves nothing to compare a probe against, so it cannot be collected.
  const baseline = runChecker(pinned);
  expect(baseline.exitCode, `${key}: the retained checker must pass before a probe means anything`).toBe(0);
  expect([baseline.testsPassed, baseline.testsTotal]).toEqual([expected.tests, expected.tests]);
  expect([baseline.assertsPassed, baseline.assertsTotal]).toEqual([expected.asserts, expected.asserts]);
  // The unmodified transcript has no dummy-file read in the blocked arm.
  expect(trace.split('### ARM: ')[2]).not.toContain('dummy-canary.txt');
  files.set('runs/baseline/result.txt', result(key, 'none', baseline, 'none (retained evidence as pinned)'));

  // Question 1. The flaw: nothing reads the trace, so nothing changes.
  const deleted = deletedTrace(pinned);
  expect(deleted.has('canary-reads.txt')).toBe(false);
  runs['deleted-trace'] = runChecker(deleted);
  answers.set('probes/deleted-trace/answer.json', answerJson(runs['deleted-trace']));
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
  answers.set('probes/forged-read/answer.json', answerJson(runs['forged-read']));
  files.set('probes/forged-read/canary-reads.txt', forged);
  files.set('probes/forged-read/mutation.txt', `added to the mat-blocked arm of canary-reads.txt:\n+${FORGED_LINE}\n`);
  files.set('probes/forged-read/result.txt', result(key, 'forged-read', runs['forged-read'], 'dummy-file openat added to the mat-blocked arm'));

  // The answers go on the report; they are not asserted.
  for (const probe of Object.keys(runs) as ProbeName[]) {
    test.info().annotations.push({ type: `${key} ${probe}`, description: `${noticed(runs[probe]) ? 'noticed' : 'not noticed'}: ${runs[probe].summary}` });
  }

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
  for (const [file, body] of [...files, ...answers]) {
    if (!committed(path.join(reproductionDir(key), file), body).matches) drift.push(`reproduction/${key}/${file}`);
  }
  for (const [file, body] of [[starterFixture(key), starter], [solvedFixture(key), solved]]) if (!committed(file, body).matches) drift.push(path.basename(file));
  expect(drift, 'committed reproduction differs from this run; rerun with CIT307_UPDATE=1').toEqual([]);

  return { files, starter, solved, prose };
}

test('Can the checker be trusted', { tag: '@tutorial' }, async ({}, testInfo) => {
  // The lesson file state at the end of the previous lesson. Each lesson starts
  // from it with only the trace replaced (the incoming turn), so the reporter's
  // continuity check holds the second lesson to what the first one left.
  let end = new Map<string, string>();

  for (const [i, { key, title }] of CHAPTER.entries()) {
    const index = i + 1;
    await test.step(title, async () => {
      const { files, starter, solved, prose } = ask(key);

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
    const messages = renderTraces(key, new Map((['deleted-trace', 'forged-read'] as const).map((probe) => [`probes/${probe}/answer.json`, answerJson(run)]))).solved;
    expect(messages).toContain(answerText('deleted-trace', run));
    expect(messages).toContain(`${run.assertsPassed} of ${run.assertsTotal} assertions pass`);
    expect(messages).not.toContain(`Deleting the trace still left all ${run.assertsTotal} assertions passing.`);
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
