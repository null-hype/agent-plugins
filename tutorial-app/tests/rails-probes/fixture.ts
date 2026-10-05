import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPRODUCTION_ID, REVISIONS, noticed, type CheckerRun, type RevisionKey } from './probes';

// CIT-307 x CIT-253 x CIT-312: the Rails/MATLAB review traces are rendered
// from `traces/CheckerProbes.pkl`. The numbers in each probe's diagnostic, and
// the rows that show what the probe produced, come from the executed run's
// answers. Everything else (the review's own words, the subject, the framing)
// is authored in the module.

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The traces are checked where the lesson keeps them (CIT-319): the reporter
// writes lesson N of the chapter from state N, starter in `_files` and solved in
// `_solution`. There is no second copy for Storybook; its viewer reads these.
const CHAPTER = path.join(APP, 'src/content/tutorial/part-4/can-the-checker-be-trusted');
const fixtureFile = (key: RevisionKey, kind: 'starter' | 'solved') => {
  const prefix = `${REVISIONS[key].review}-`;
  const lesson = existsSync(CHAPTER) ? readdirSync(CHAPTER).find((name) => name.startsWith(prefix)) : undefined;
  return path.join(CHAPTER, lesson ?? `${prefix}missing`, kind === 'starter' ? '_files' : '_solution', 'acp-trace.json');
};
export const starterFixture = (key: RevisionKey) => fixtureFile(key, 'starter');
export const solvedFixture = (key: RevisionKey) => fixtureFile(key, 'solved');
export const reproductionDir = (key: RevisionKey) => path.join(APP, 'evidence/cit-294-probe-reproduction-v1/reproduction', key);

export type ProbeName = 'deleted-trace' | 'forged-read';

const DID: Record<ProbeName, string> = {
  'deleted-trace': 'Deleting the trace',
  'forged-read': 'Forging a dummy-file read',
};

/** What the checker said to a probe, in the words of the diagnostic: either answer is data (CIT-311). */
export const answerText = (probe: ProbeName, run: CheckerRun) =>
  noticed(run)
    ? `${DID[probe]} made the check fail${run.assertsTotal === null ? '' : `: ${run.assertsPassed} of ${run.assertsTotal} assertions passed`} (pkl test exit ${run.exitCode}).`
    : `${DID[probe]} still left all ${run.assertsTotal} assertions passing.`;

/** What the runner records for one probe: the only measured input to a Pkl-authored trace (CIT-312). */
export const answerJson = (run: CheckerRun) =>
  `${JSON.stringify(
    { exitCode: run.exitCode, testsPassed: run.testsPassed, testsTotal: run.testsTotal, assertsPassed: run.assertsPassed, assertsTotal: run.assertsTotal },
    null,
    2,
  )}\n`;

/**
 * Render one state's traces from the Pkl claims and a run's answers. `files`
 * holds each probe's `answer.json` by its path under `reproductionDir(key)`;
 * the module reads those and nothing else measured.
 */
export function renderTraces(key: RevisionKey, files: Map<string, string>): { starter: string; solved: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'cit-312-'));
  try {
    const run = path.join(dir, 'run');
    for (const [file, body] of files) {
      mkdirSync(path.dirname(path.join(run, file)), { recursive: true });
      writeFileSync(path.join(run, file), body);
    }
    const out = path.join(dir, 'out');
    const props = { state: key, checker: REVISIONS[key].revision, reproductionId: REPRODUCTION_ID, run };
    execFileSync('pkl', ['eval', '-m', out, path.join(APP, 'tests/rails-probes/traces/CheckerProbes.pkl'), ...Object.entries(props).flatMap(([k, v]) => ['-p', `${k}=${v}`])], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    return { starter: readFileSync(path.join(out, 'starter.json'), 'utf8'), solved: readFileSync(path.join(out, 'solved.json'), 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Compare `bytes` with the committed file, or (CIT307_UPDATE=1) rewrite it. A
 * mismatch means the committed reproduction no longer matches what the checker
 * does, which is exactly what this test exists to notice.
 */
export function committed(file: string, bytes: string): { matches: boolean; wrote: boolean } {
  if (process.env.CIT307_UPDATE) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    return { matches: true, wrote: true };
  }
  return { matches: existsSync(file) && readFileSync(file, 'utf8') === bytes, wrote: false };
}
