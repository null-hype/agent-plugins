import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKED_REVISION, REPRODUCTION_ID, type CheckerRun } from './probes';

// CIT-307 x CIT-253: the Rails/MATLAB review-1 solved fixture is no longer only
// hand-written. The numbers in each probe's diagnostic, and the rows that show
// what the probe produced, come from the executed run. Everything else in the
// fixture (the review's own words, the subject, the framing) stays authored.

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SOLVED_FIXTURE = path.join(APP, 'src/stories/fixtures/rails-matlab-review-1.solved.json');
export const REPRODUCTION_DIR = path.join(APP, 'evidence/cit-294-probe-reproduction-v1/reproduction');
const REPRODUCTION_URI = 'evidence/cit-294-probe-reproduction-v1/reproduction';

type Row = { role: string; uri: string; line?: number; revision?: string; detail: string };
type Fixture = { frames: { envelope: { result?: { _meta?: any } } }[] };

export type ProbeName = 'deleted-trace' | 'forged-read';

const STILL_PASSING: Record<ProbeName, (n: number) => string> = {
  'deleted-trace': (n) => `Deleting the trace still left all ${n} assertions passing.`,
  'forged-read': (n) => `Forging a dummy-file read still left all ${n} assertions passing.`,
};

const WHAT: Record<ProbeName, string> = {
  'deleted-trace': 'canary-reads.txt removed',
  'forged-read': 'a dummy-file openat added to the mat-blocked arm of canary-reads.txt',
};

/** The row that shows what a probe produced. Labelled a reproduction, never the reviewers' own output. */
export function reproductionRow(probe: ProbeName, run: CheckerRun): Row {
  return {
    role: 'observation',
    uri: `${REPRODUCTION_URI}/probes/${probe}/result.txt`,
    detail:
      `REPRODUCTION ${REPRODUCTION_ID} (a new run, not the reviewers' own output): ` +
      `${WHAT[probe]}; checker ${CHECKED_REVISION.slice(0, 8)}; pkl test exit ${run.exitCode}, ` +
      `${run.assertsPassed} of ${run.assertsTotal} assertions pass`,
  };
}

const isReproductionRow = (row: Row) => row.uri.startsWith(`${REPRODUCTION_URI}/`);

/** Idempotent: applying it to its own output changes nothing. */
export function applyReproduction(base: Fixture, runs: Record<ProbeName, CheckerRun>): Fixture {
  const fixture = structuredClone(base);
  const meta = fixture.frames.map((frame) => frame.envelope.result?._meta).find((m) => m?.diagnostic);
  if (!meta) throw new Error('solved fixture has no diagnostic frame');

  const probes = meta.probes as { diagnostic: { code: string; message: string; related: Row[] } }[];
  const withRow = (rows: Row[], row: Row, after: (r: Row) => boolean) => {
    const kept = rows.filter((r) => !isReproductionRow(r));
    const at = kept.findIndex(after);
    kept.splice(at === -1 ? kept.length : at + 1, 0, row);
    return kept;
  };
  const missingOutput = (r: Row) => r.uri === 'review-1/finding-1/mutation-output';

  for (const name of Object.keys(runs) as ProbeName[]) {
    const probe = probes.find((p) => p.diagnostic.code === `review-1.finding-1.${name}`);
    if (!probe) throw new Error(`no ${name} probe in the solved fixture`);
    const run = runs[name];
    probe.diagnostic.message = `${probe.diagnostic.code}: ${STILL_PASSING[name](run.assertsTotal)}`;
    // Deleted-trace shows the reviewers' missing output next to the new run; forged-read has none.
    probe.diagnostic.related = withRow(probe.diagnostic.related, reproductionRow(name, run), (r) =>
      name === 'deleted-trace' ? missingOutput(r) : r.uri.startsWith('docs/investigations/CIT-265/cit-294/Reconcile.pkl'),
    );
  }

  // The finding itself keeps its row for the reviewers' missing output and gains both reproductions.
  const finding = meta.diagnostic as { related: Row[] };
  const rows = finding.related.filter((r) => !isReproductionRow(r));
  const at = rows.findIndex(missingOutput);
  rows.splice(at === -1 ? rows.length : at + 1, 0, reproductionRow('deleted-trace', runs['deleted-trace']), reproductionRow('forged-read', runs['forged-read']));
  finding.related = rows;
  return fixture;
}

export const readSolvedFixture = (): Fixture => JSON.parse(readFileSync(SOLVED_FIXTURE, 'utf8'));
export const serialize = (fixture: Fixture) => `${JSON.stringify(fixture, null, 2)}\n`;

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
