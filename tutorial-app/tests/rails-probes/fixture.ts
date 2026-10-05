import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKER_DIR, REPRODUCTION_ID, REVISIONS, noticed, type CheckerRun, type RevisionKey } from './probes';

// CIT-307 x CIT-253 x CIT-312: the Rails/MATLAB review fixtures are rendered
// from `traces/CheckerProbes.pkl`. The numbers in each probe's diagnostic, and
// the rows that show what the probe produced, come from the executed run's
// answers. Everything else (the review's own words, the subject, the framing)
// is authored in the module.

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureFile = (key: RevisionKey, kind: 'starter' | 'solved') =>
  path.join(APP, `src/stories/fixtures/rails-matlab-review-${REVISIONS[key].review}.${kind}.json`);
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

type TraceRow = { uri: string; artifact?: { artifactId: string; recordingId: string; runId: string; frameId: string; path: string; identity: { kind: string; revision?: string }; location: { kind: string; startLine?: number; endLine?: number } } };

/**
 * CIT-301: the bytes behind every row of the solved trace that cites a captured
 * artifact, as the evidence bundle the previews resolve them from. Each artifact
 * is the pinned file's own bytes (`pinned` was verified against the history
 * manifest), cited at the full commit the checker was pinned to. A row that
 * cites a file or lines the pinned checker does not have fails here, so the
 * bundle cannot be written from a reference that does not resolve. `null` when
 * the state cites no artifact.
 */
export function evidenceBundleFor(key: RevisionKey, solved: string, pinned: Map<string, Buffer>): string | null {
  const meta = JSON.parse(solved).frames[1].envelope.result._meta;
  const rows: TraceRow[] = [...meta.diagnostic.related, ...meta.probes.flatMap((probe: { diagnostic: { related: TraceRow[] } }) => probe.diagnostic.related)];
  const artifacts = new Map<string, object>();
  for (const { artifact } of rows) {
    if (!artifact) continue;
    const name = artifact.path.slice(`${CHECKER_DIR}/`.length);
    const bytes = artifact.path.startsWith(`${CHECKER_DIR}/`) ? pinned.get(name) : undefined;
    if (!bytes) throw new Error(`${artifact.artifactId}: ${artifact.path} is not in the pinned checker`);
    if (artifact.identity.kind !== 'revision' || artifact.identity.revision !== REVISIONS[key].revision) throw new Error(`${artifact.artifactId}: not cited at the pinned commit`);
    const content = bytes.toString('utf8');
    const { startLine, endLine } = artifact.location;
    if (artifact.location.kind !== 'source-range' || !startLine || !endLine || endLine < startLine || endLine > content.split('\n').length) throw new Error(`${artifact.artifactId}: lines ${startLine}-${endLine} are outside ${name}`);
    artifacts.set(artifact.artifactId, {
      artifactId: artifact.artifactId,
      recordingId: artifact.recordingId,
      runId: artifact.runId,
      frameId: artifact.frameId,
      path: artifact.path,
      identity: artifact.identity,
      // The pinned file's digest (it matched the history manifest when loaded), so a host can
      // tell these bytes from an edited copy wherever the bundle travels.
      sha256: createHash('sha256').update(bytes).digest('hex'),
      content,
    });
  }
  if (artifacts.size === 0) return null;
  return `${JSON.stringify({ format: 'governance-evidence-bundle/v1', artifacts: [...artifacts.values()] }, null, 2)}\n`;
}
