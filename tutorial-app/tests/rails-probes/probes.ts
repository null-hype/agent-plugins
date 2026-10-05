import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// CIT-307: run the two review-1 probes against the pinned PR 117 checker.
//
// Everything is read from committed evidence: the review-history bundle for the
// S1 files it holds, and the reproduction supplement for the two Pkl modules
// that bundle does not. Nothing is read from the working tree's current
// docs/investigations. Each probe runs in its own temporary copy.

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HISTORY = path.join(APP, 'evidence/cit-294-review-history-v1');
const SUPPLEMENT = path.join(APP, 'evidence/cit-294-probe-reproduction-v1');
const CHECKER_DIR = 'docs/investigations/CIT-265/cit-294';

export const REPRODUCTION_ID = 'cit-294-checker-probes-reproduction-v1';

/**
 * The revision is an input: one set of probes, one runner, asked of each
 * checker state. `revision` is the commit the review cited (not on main);
 * `mergedEquivalent` is the rebased commit that is, with the same cit-294 tree
 * (`treeEquality` in the history manifest). `supplement` is what that state's
 * suite needs and the history bundle does not hold, by git blob id.
 */
export type RevisionKey = 'S1' | 'S2';
export const REVISIONS: Record<
  RevisionKey,
  {
    pr: number;
    review: number;
    /** The finding the probes test, by its id in the recorded review history (CIT-313). */
    findingId: string;
    revision: string;
    mergedEquivalent: string;
    supplement: Record<string, string>;
    baseline: { tests: number; asserts: number };
  }
> = {
  S1: {
    pr: 117,
    review: 1,
    findingId: 'review-1.finding-1',
    revision: '20aafd26372a832224be824f72f4a615ee671094',
    mergedEquivalent: '390a7873ea6fd639c1c735393848e03b05031cc3',
    supplement: {
      'Claims.pkl': 'a6cf7949c033dcfb5b4ae85dbe53413443cc97f5',
      'Observation.pkl': '6e1594b8483db9a0b272e01daa9e3edf1d10271b',
      'cit294.test.pkl-expected.pcf': '73d902a2a97e4ecfed10775c831b3f3427cab44a',
    },
    baseline: { tests: 12, asserts: 28 },
  },
  S2: {
    pr: 118,
    review: 2,
    findingId: 'review-2.gap-1',
    revision: '8d097c8e16bd1db44d5d4f558ad99938585e1001',
    mergedEquivalent: '9739b539de26919f1d1bb8129df8954de40dbfcd',
    // Observation.pkl is already in the history bundle at S2.
    supplement: {
      'Claims.pkl': '44d3e6d5deaef5e6988ea684ed3f5a938774b0dc',
      'cit294.test.pkl-expected.pcf': 'e24e660619ab051753fd6339d82ade2626ad536b',
    },
    baseline: { tests: 22, asserts: 56 },
  },
};

type ManifestFile = { state: string; revision: string; path: string; blobId: string; sha256: string; file: string };

const gitBlobId = (bytes: Buffer) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export function pklVersion(): string | null {
  try {
    return execFileSync('pkl', ['--version'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/** One state's checker inputs, each verified against the history manifest or the supplement. Throws on any mismatch. */
export function loadPinnedChecker(key: RevisionKey): Map<string, Buffer> {
  const { revision, supplement } = REVISIONS[key];
  const manifest = JSON.parse(readFileSync(path.join(HISTORY, 'manifest.json'), 'utf8')) as { files: ManifestFile[] };
  const inputs = new Map<string, Buffer>();
  for (const entry of manifest.files) {
    if (entry.revision !== revision || !entry.path.startsWith(`${CHECKER_DIR}/`)) continue;
    const bytes = readFileSync(path.join(HISTORY, entry.file));
    if (gitBlobId(bytes) !== entry.blobId || sha256(bytes) !== entry.sha256) {
      throw new Error(`${entry.path}@${entry.revision.slice(0, 8)} does not match the history manifest`);
    }
    inputs.set(entry.path.slice(CHECKER_DIR.length + 1), bytes);
  }
  for (const [name, blobId] of Object.entries(supplement)) {
    const bytes = readFileSync(path.join(SUPPLEMENT, 'inputs', key, name));
    if (gitBlobId(bytes) !== blobId) throw new Error(`${key}/${name} does not match its pinned blob id ${blobId}`);
    inputs.set(name, bytes);
  }
  for (const required of ['cit294.test.pkl', 'Reconcile.pkl', 'Observation.pkl', 'Claims.pkl', 'canary-reads.txt', 'observations/mat-blocked.json']) {
    if (!inputs.has(required)) throw new Error(`pinned checker input missing for ${key}: ${required}`);
  }
  return inputs;
}

export type CheckerRun = {
  /** Every file the checker saw, by path under cit-294/. A probe removes or rewrites some. */
  files: Map<string, Buffer>;
  exitCode: number;
  facts: string[];
  summary: string;
  /** null when the checker failed without printing a summary (it stopped before counting): the failure is the answer. */
  testsPassed: number | null;
  testsTotal: number | null;
  assertsPassed: number | null;
  assertsTotal: number | null;
};

/**
 * What the checker answered to a probe. A probe the checker fails on is
 * "noticed"; one it still passes is "not noticed". Neither is a failure of the
 * collection: only a run that cannot be made, or read, is (CIT-311).
 */
export const noticed = (run: CheckerRun) => run.exitCode !== 0 || run.assertsPassed !== run.assertsTotal;

/** "28 of 28" / "27 of 28", or a plain statement when the checker stopped before counting. */
export const assertionCounts = (run: CheckerRun) =>
  run.assertsTotal === null ? 'no assertion count (the checker stopped before counting)' : `${run.assertsPassed} of ${run.assertsTotal} assertions pass`;

/** Write `files` to a fresh temp directory and run `pkl test` there. */
export function runChecker(files: Map<string, Buffer>): CheckerRun {
  const dir = mkdtempSync(path.join(tmpdir(), 'cit-307-'));
  try {
    for (const [rel, bytes] of files) {
      const target = path.join(dir, rel);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
    let output = '';
    let exitCode = 0;
    try {
      output = execFileSync('pkl', ['test', 'cit294.test.pkl'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      exitCode = failure.status ?? 1;
      output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
    }
    // Without the expected-examples file pkl WRITES one and reports no summary; that is not a check.
    if (/examples written/.test(output)) throw new Error('pkl wrote examples instead of comparing them: expected file missing');
    // The summary line is "100.0% tests pass [12 passed], 100.0% asserts pass [28 passed]"
    // (or "[n/m failed]" when anything fails); pull the counts, not the percentages.
    const summary = output.split('\n').filter((l) => /% tests pass/.test(l)).join('').trim();
    const count = (kind: 'tests' | 'asserts') => {
      const m = summary.match(new RegExp(`% ${kind} pass \\[(?:(\\d+) passed|(\\d+)/(\\d+) failed)\\]`));
      // A checker that exits non-zero before it prints a summary has answered the probe (it
      // noticed); a clean exit with no summary has not answered anything, so it cannot be collected.
      if (!m && exitCode !== 0) return { passed: null, total: null };
      if (!m) throw new Error(`cannot read ${kind} count from pkl output: ${summary || output.slice(0, 200)}`);
      return m[1] ? { passed: Number(m[1]), total: Number(m[1]) } : { passed: Number(m[3]) - Number(m[2]), total: Number(m[3]) };
    };
    const tests = count('tests');
    const asserts = count('asserts');
    return {
      files,
      exitCode,
      facts: output.split('\n').filter((l) => /^\s+[✔✘]/.test(l)).map((l) => l.trim()),
      summary: summary || output.trim().split('\n')[0],
      testsPassed: tests.passed,
      testsTotal: tests.total,
      assertsPassed: asserts.passed,
      assertsTotal: asserts.total,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const copyFiles = (files: Map<string, Buffer>) => new Map(files);

/** Probe 1: delete the retained strace transcript entirely. */
export function deletedTrace(pinned: Map<string, Buffer>): Map<string, Buffer> {
  const files = copyFiles(pinned);
  files.delete('canary-reads.txt');
  return files;
}

export const FORGED_LINE =
  '[pid    16] openat(AT_FDCWD</app>, "/work/dummy-canary.txt", O_RDONLY) = 14</work/dummy-canary.txt>';

/** Probe 2: add a dummy-file read to the blocked MAT arm of the transcript. Returns the new transcript. */
export function forgedRead(pinned: Map<string, Buffer>): Map<string, Buffer> {
  const files = copyFiles(pinned);
  const trace = files.get('canary-reads.txt')!.toString('utf8');
  const marker = '### ARM: mat-blocked\n== strace openat evidence for the canary/control file ==\n';
  if (!trace.includes(marker)) throw new Error('mat-blocked arm header not found in the pinned transcript');
  const blockedArm = trace.split('### ARM: ')[2];
  if (!blockedArm?.startsWith('mat-blocked') || blockedArm.includes('dummy-canary.txt')) {
    throw new Error('the pinned blocked arm is not the expected no-read baseline');
  }
  files.set('canary-reads.txt', Buffer.from(trace.replace(marker, `${marker}${FORGED_LINE}\n`), 'utf8'));
  return files;
}

