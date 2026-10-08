import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPRODUCTION_ID, REVISIONS, noticed, type CheckerRun, type RevisionKey } from './probes';

// CIT-307 x CIT-253 x CIT-312: the Rails/MATLAB review fixtures are rendered
// from `traces/CheckerProbes.pkl`. The numbers in each probe's diagnostic, and
// the rows that show what the probe produced, come from the executed run's
// answers. Everything else (the review's own words, the subject, the framing,
// and each lesson's title, place and prose: CIT-316) is authored in the module.

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = path.join(APP, 'tests/rails-probes/traces/CheckerProbes.pkl');
// Named by the review of the revision, or by the revision when none is recorded;
// a lesson that continues the review (CIT-357) adds its place in it, from 2.
const fixtureFile = (key: RevisionKey, kind: 'starter' | 'solved', step: number) =>
  path.join(APP, `src/stories/fixtures/rails-matlab-${REVISIONS[key].review ? `review-${REVISIONS[key].review}` : key.toLowerCase()}${step ? `-${step + 1}` : ''}.${kind}.json`);
export const starterFixture = (key: RevisionKey, step = 0) => fixtureFile(key, 'starter', step);
export const solvedFixture = (key: RevisionKey, step = 0) => fixtureFile(key, 'solved', step);
export const reproductionDir = (key: RevisionKey) => path.join(APP, 'evidence/cit-294-probe-reproduction-v1/reproduction', key);

export type ProbeName = 'forged-read' | 'deleted-trace' | 'generic-crash' | 'emptied-bytes' | 'corrupted-pixels' | 'swapped-source' | 'changed-config'
  | 'prose-mention' | 'failed-open' | 'other-directory';

const DID: Record<ProbeName, string> = {
  'forged-read': 'Forging a read of the private file',
  'deleted-trace': 'Deleting the trace',
  'generic-crash': 'Recording the block as a generic crash',
  'emptied-bytes': 'Emptying the returned bytes',
  'corrupted-pixels': "Corrupting the PNG control's pixels",
  'swapped-source': "Recording a different upload for the blocked arm",
  'changed-config': "Recording a different configuration for the blocked arm",
  'prose-mention': 'Replacing the real read with a prose mention of the private file',
  'failed-open': 'Replacing the real read with a failed open of the private file',
  'other-directory': 'Replacing the real read with an open of a same-named file elsewhere',
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
 * The chapter's lessons in order, as the module declares them: each state's own
 * lesson (step 0), then the lessons that continue its review (CIT-357). Needs no run.
 */
export function chapter(): { key: RevisionKey; step: number; title: string }[] {
  const expr = 'new JsonRenderer {}.renderValue(lessons)';
  return JSON.parse(execFileSync('pkl', ['eval', '-x', expr, MODULE], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

/**
 * Render one state's traces and lesson prose from the Pkl claims and a run's answers. `files`
 * holds each probe's `answer.json` by its path under `reproductionDir(key)`;
 * the module reads those and nothing else measured. `step` picks the state's
 * lesson: 0 for its own, k for the k-th that continues its review.
 */
export function renderTraces(key: RevisionKey, files: Map<string, string>, step = 0): { starter: string; solved: string; prose: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'cit-312-'));
  try {
    const run = path.join(dir, 'run');
    for (const [file, body] of files) {
      mkdirSync(path.dirname(path.join(run, file)), { recursive: true });
      writeFileSync(path.join(run, file), body);
    }
    const out = path.join(dir, 'out');
    const props = { state: key, step, checker: REVISIONS[key].revision, reproductionId: REPRODUCTION_ID, run };
    execFileSync('pkl', ['eval', '-m', out, MODULE, ...Object.entries(props).flatMap(([k, v]) => ['-p', `${k}=${v}`])], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const read = (file: string) => readFileSync(path.join(out, file), 'utf8');
    return { starter: read('starter.json'), solved: read('solved.json'), prose: read('lesson.md') };
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
