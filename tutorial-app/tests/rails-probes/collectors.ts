import { expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Collector } from '../questions/collectors';
import { answerJson, type ProbeName } from './fixture';
import { FORGED_LINE, REPRODUCTION_ID, REVISIONS, changedConfig, corruptedPixels, deletedTrace, emptiedBytes, forgedRead, genericCrash, loadPinnedChecker, runChecker, swappedSource, type CheckerRun, type RevisionKey } from './probes';

// CIT-317: the collectors the two Questions in `traces/CheckerProbes.pkl` name.
// Each asks its probe of every checker state, for real, in its own copy of the
// pinned checker, and writes what it found into the part's run directory laid
// out as the reproduction is (`<state>/probes/<name>/answer.json`, ...). The
// lesson project reads that directory; nothing here judges the answer.
//
// The probes RECORD WHAT THE CHECKER DID (CIT-311). Either answer is data. A
// throw means only that the answer could not be collected: the pinned inputs
// do not hash, the baseline does not pass, the mutation does not apply, or
// `pkl test` exits cleanly without a readable summary.

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

const write = (file: string, body: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
};

/** The mutated files for one probe, and what the mutation was, after checking it is exactly that mutation. */
function mutate(name: ProbeName, pinned: Map<string, Buffer>, trace: string) {
  if (name === 'deleted-trace') {
    // The flaw: nothing reads the trace, so nothing changes.
    const files = deletedTrace(pinned);
    expect(files.has('canary-reads.txt')).toBe(false);
    return { files, what: 'canary-reads.txt removed', record: { 'mutation.txt': 'removed: canary-reads.txt (the whole retained strace transcript)\n' } };
  }
  // An edit to one recorded observation: the lesson keeps the edited record.
  const edits = { 'generic-crash': genericCrash, 'emptied-bytes': emptiedBytes, 'corrupted-pixels': corruptedPixels, 'swapped-source': swappedSource, 'changed-config': changedConfig } as const;
  if (name in edits) {
    const { files, file, text } = edits[name as keyof typeof edits](pinned);
    const what = {
      'generic-crash': 'the blocked MAT arm refused with RuntimeError: disk full instead of the matload block',
      'emptied-bytes': "the unblocked MAT arm's returned bytes emptied and their count set to 0",
      'corrupted-pixels': "the blocked PNG control's pixels set to ffffffff",
      'swapped-source': "the blocked MAT arm's source sha256 replaced with another valid one",
      'changed-config': "the blocked MAT arm's Rails defaults set to 6.1 and its variant processor to mini_magick",
    }[name as keyof typeof edits];
    return { files, what, record: { [file]: text, 'mutation.txt': `edited ${file}: ${what}\n` } };
  }
  // A dummy-file read in the blocked arm, which blocking should prevent.
  const files = forgedRead(pinned);
  const forged = files.get('canary-reads.txt')!.toString('utf8');
  expect(forged.split('### ARM: ')[2]).toContain('dummy-canary.txt');
  // The only difference from the pinned transcript is the one added line.
  const arms = forged.split('### ARM: ');
  arms[2] = arms[2].replace(`${FORGED_LINE}\n`, '');
  expect(arms.join('### ARM: ')).toBe(trace);
  return {
    files,
    what: 'dummy-file openat added to the mat-blocked arm',
    record: { 'canary-reads.txt': forged, 'mutation.txt': `added to the mat-blocked arm of canary-reads.txt:\n+${FORGED_LINE}\n` },
  };
}

// A probe is asked from the revision whose review raised it (`from` in
// CheckerProbes.pkl) on: never of a revision before it, which would leak a
// later review into an earlier lesson.
const probe = (name: ProbeName): Collector => (partDir, { question }) =>
  (Object.keys(REVISIONS) as RevisionKey[]).slice((Object.keys(REVISIONS) as RevisionKey[]).indexOf(question.from)).map((key) => {
    const { baseline: expected } = REVISIONS[key];
    const pinned = loadPinnedChecker(key);
    const trace = pinned.get('canary-reads.txt')!.toString('utf8');
    const dir = path.join(partDir, key);

    // The baseline is a precondition, not an answer: a checker that does not pass
    // as retained leaves nothing to compare a probe against.
    const baseline = runChecker(pinned);
    expect(baseline.exitCode, `${key}: the retained checker must pass before a probe means anything`).toBe(0);
    expect([baseline.testsPassed, baseline.testsTotal]).toEqual([expected.tests, expected.tests]);
    expect([baseline.assertsPassed, baseline.assertsTotal]).toEqual([expected.asserts, expected.asserts]);
    // The unmodified transcript has no dummy-file read in the blocked arm.
    expect(trace.split('### ARM: ')[2]).not.toContain('dummy-canary.txt');
    write(path.join(dir, 'runs/baseline/result.txt'), result(key, 'none', baseline, 'none (retained evidence as pinned)'));
    // The trace as retained, which the trace probes delete or forge into.
    write(path.join(dir, 'runs/baseline/canary-reads.txt'), trace);

    const { files, what, record } = mutate(name, pinned, trace);
    const run = runChecker(files);
    const answer = answerJson(run);
    for (const [file, body] of Object.entries(record)) write(path.join(dir, 'probes', name, file), body);
    write(path.join(dir, 'probes', name, 'result.txt'), result(key, name, run, what));
    write(path.join(dir, 'probes', name, 'answer.json'), answer);
    return { at: key, answer: JSON.parse(answer) };
  });

export const railsProbes: Record<string, Collector> = {
  'forged-read': probe('forged-read'),
  'deleted-trace': probe('deleted-trace'),
  'generic-crash': probe('generic-crash'),
  'emptied-bytes': probe('emptied-bytes'),
  'corrupted-pixels': probe('corrupted-pixels'),
  'swapped-source': probe('swapped-source'),
  'changed-config': probe('changed-config'),
};
