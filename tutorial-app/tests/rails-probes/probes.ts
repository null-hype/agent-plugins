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
export type RevisionKey = 'S1' | 'S2' | 'S3' | 'S4';
export const REVISIONS: Record<
  RevisionKey,
  {
    pr: number;
    /** The review of this revision; null when none is recorded (S4). */
    review: number | null;
    /** The revision's headline finding, by its id in the recorded review history (CIT-313). */
    findingId: string;
    revision: string;
    /** The rebased copy on main, or null when the revision is the only spelling (S3, S4: GitHub re-created both at merge). */
    mergedEquivalent: string | null;
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
  S3: {
    pr: 120,
    // Known second-hand: its own text is lost (captures/review-3-retrieval-check.json).
    review: 3,
    findingId: 'review-3.finding-1',
    revision: '296ca9f87ea04809b4d21da5bd4d617784856c27',
    mergedEquivalent: null,
    supplement: { 'cit294.test.pkl-expected.pcf': 'e24e660619ab051753fd6339d82ade2626ad536b' },
    baseline: { tests: 29, asserts: 71 },
  },
  S4: {
    pr: 120,
    // No review of the final revision is recorded; it was merged.
    review: null,
    findingId: 'landed.history',
    revision: 'cc23e89297855dd07b1ee477ced455ab46a94738',
    mergedEquivalent: null,
    supplement: {
      'Claims.pkl': '02d60a9ca312977d17de236bcbb4ce5b0d0f3b90',
      'Observation.pkl': '2c43ce1e88ee7b7039f0ba1da9276d23cf18d65d',
      'cit294.test.pkl-expected.pcf': 'e24e660619ab051753fd6339d82ade2626ad536b',
    },
    baseline: { tests: 33, asserts: 75 },
  },
};

type ManifestFile = { state: string; revision: string; path: string; blobId: string; sha256: string; file: string };

export const gitBlobId = (bytes: Buffer) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
export const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export function pklVersion(): string | null {
  try {
    return execFileSync('pkl', ['--version'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/** One checker input as pinned: its name under cit-294/, the committed file it was read from, and its ids. */
export type PinnedInput = {
  name: string;
  /** The committed file, relative to tutorial-app. */
  file: string;
  /** Where its id is pinned: the history manifest, or this revision's supplement. */
  pinnedBy: 'history' | 'supplement';
  blobId: string;
  sha256: string;
  bytes: Buffer;
};

/** One state's checker inputs with their provenance, each verified against the history manifest or the supplement. Throws on any mismatch. */
export function pinnedInputs(key: RevisionKey): PinnedInput[] {
  const { revision, supplement } = REVISIONS[key];
  const manifest = JSON.parse(readFileSync(path.join(HISTORY, 'manifest.json'), 'utf8')) as { files: ManifestFile[] };
  const inputs: PinnedInput[] = [];
  for (const entry of manifest.files) {
    if (entry.revision !== revision || !entry.path.startsWith(`${CHECKER_DIR}/`)) continue;
    const file = path.join(HISTORY, entry.file);
    const bytes = readFileSync(file);
    if (gitBlobId(bytes) !== entry.blobId || sha256(bytes) !== entry.sha256) {
      throw new Error(`${entry.path}@${entry.revision.slice(0, 8)} does not match the history manifest`);
    }
    inputs.push({ name: entry.path.slice(CHECKER_DIR.length + 1), file: path.relative(APP, file), pinnedBy: 'history', blobId: entry.blobId, sha256: entry.sha256, bytes });
  }
  for (const [name, blobId] of Object.entries(supplement)) {
    const file = path.join(SUPPLEMENT, 'inputs', key, name);
    const bytes = readFileSync(file);
    if (gitBlobId(bytes) !== blobId) throw new Error(`${key}/${name} does not match its pinned blob id ${blobId}`);
    inputs.push({ name, file: path.relative(APP, file), pinnedBy: 'supplement', blobId, sha256: sha256(bytes), bytes });
  }
  for (const required of ['cit294.test.pkl', 'Reconcile.pkl', 'Observation.pkl', 'Claims.pkl', 'canary-reads.txt', 'observations/mat-blocked.json']) {
    if (!inputs.some((input) => input.name === required)) throw new Error(`pinned checker input missing for ${key}: ${required}`);
  }
  return inputs;
}

/** One state's checker inputs, each verified against the history manifest or the supplement. Throws on any mismatch. */
export function loadPinnedChecker(key: RevisionKey): Map<string, Buffer> {
  return new Map(pinnedInputs(key).map(({ name, bytes }) => [name, bytes]));
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

/**
 * Whether the checker reads the trace embedded in each observation
 * (`independent_trace_text`, from #120 on) rather than the committed
 * transcript, which no version of the checker reads. A trace probe edits the
 * trace the checker reads.
 */
export const embeddedTrace = (pinned: Map<string, Buffer>) =>
  pinned.get('observations/mat-blocked.json')!.toString('utf8').includes('"independent_trace_text"');

/** Replace one arm's embedded trace text, keeping the record's formatting. */
function editTrace(pinned: Map<string, Buffer>, arm: string, edit: (trace: string) => string) {
  const file = `observations/${arm}.json`;
  const before = JSON.parse(pinned.get(file)!.toString('utf8')).independent_trace_text as string;
  return editObservation(pinned, arm, [[`"independent_trace_text": ${JSON.stringify(before)}`, `"independent_trace_text": ${JSON.stringify(edit(before))}`]]);
}

/** Probe 1: delete the retained trace: the committed transcript, or from #120 on the blocked arm's embedded trace. */
export function deletedTrace(pinned: Map<string, Buffer>): Map<string, Buffer> {
  if (embeddedTrace(pinned)) return editTrace(pinned, 'mat-blocked', () => '').files;
  const files = copyFiles(pinned);
  files.delete('canary-reads.txt');
  return files;
}

export const FORGED_LINE =
  '[pid    16] openat(AT_FDCWD</app>, "/work/dummy-canary.txt", O_RDONLY) = 14</work/dummy-canary.txt>';

/** Probe 2: add a read of the private file to the blocked MAT arm's trace: the transcript, or from #120 on its embedded trace. */
export function forgedRead(pinned: Map<string, Buffer>): Map<string, Buffer> {
  if (embeddedTrace(pinned)) return editTrace(pinned, 'mat-blocked', (trace) => `${trace}\n${FORGED_LINE}`).files;
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


/**
 * One review-1 edit to a recorded observation: each `[from, to]` line of
 * `observations/<arm>.json` is replaced, and must occur exactly once. Returns the
 * files and the edited observation, so the lesson can show the edit itself.
 */
function editObservation(pinned: Map<string, Buffer>, arm: string, lines: [string, string][]) {
  const files = copyFiles(pinned);
  const file = `observations/${arm}.json`;
  let text = files.get(file)!.toString('utf8');
  for (const [from, to] of lines) {
    if (text.split(from).length !== 2) throw new Error(`${file}: expected exactly one ${from}`);
    text = text.replace(from, to);
  }
  files.set(file, Buffer.from(text, 'utf8'));
  return { files, file, text };
}

/** Probe 3: the blocked arm's refusal becomes a generic crash ("RuntimeError: disk full", review 1, point 2). */
export const genericCrash = (pinned: Map<string, Buffer>) =>
  editObservation(pinned, 'mat-blocked', [
    ['"variant_error_class": "Vips::Error"', '"variant_error_class": "RuntimeError"'],
    ['"variant_error": "matload: operation is blocked"', '"variant_error": "RuntimeError: disk full"'],
  ]);

/** Probe 4: the private file's returned bytes are emptied, and their count set to zero (review 1, point 3). */
export const emptiedBytes = (pinned: Map<string, Buffer>) =>
  editObservation(pinned, 'mat-unblocked', [
    ['"returned_bytes_hex": "4b5232532d43414e4152592d4349543239342d30313233343536373839616263"', '"returned_bytes_hex": ""'],
    ['"returned_byte_count": 32', '"returned_byte_count": 0'],
  ]);

/** Probe 5: the blocked PNG control's pixels are corrupted to ffffffff (review 1, point 3). */
export const corruptedPixels = (pinned: Map<string, Buffer>) =>
  editObservation(pinned, 'png-blocked', [['"returned_bytes_hex": "00000000"', '"returned_bytes_hex": "ffffffff"']]);

/** The sha256 of empty input: a valid sha256, and not the blocked arm's upload. */
export const OTHER_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** Probe 6: the blocked arm records a different upload: its source sha256 is another valid one (review 2, gap 2). */
export const swappedSource = (pinned: Map<string, Buffer>) => {
  const text = pinned.get('observations/mat-blocked.json')!.toString('utf8');
  const sha = text.match(/"independent_source_sha256": "([0-9a-f]{64})"/)?.[1];
  if (!sha) throw new Error('observations/mat-blocked.json: no independent_source_sha256 to swap');
  return editObservation(pinned, 'mat-blocked', [[`"independent_source_sha256": "${sha}"`, `"independent_source_sha256": "${OTHER_SHA256}"`]]);
};

/** Probe 7: the blocked arm records a different configuration: Rails defaults 6.1, processor mini_magick (review 2, gap 2). */
export const changedConfig = (pinned: Map<string, Buffer>) =>
  editObservation(pinned, 'mat-blocked', [
    ['"independent_rails_load_defaults": "7.0"', '"independent_rails_load_defaults": "6.1"'],
    ['"independent_active_storage_variant_processor": "vips"', '"independent_active_storage_variant_processor": "mini_magick"'],
  ]);

/** The unblocked arm's real read of the private file, replaced by `line` (review 3, second-hand). */
const replacedRead = (pinned: Map<string, Buffer>, line: string) =>
  editTrace(pinned, 'mat-unblocked', (trace) => {
    const lines = trace.split('\n');
    const real = lines.findIndex((l) => l.includes('"/work/dummy-canary.txt"') && /= \d+</.test(l));
    if (real < 0 || lines.filter((l) => l.includes('dummy-canary.txt')).length !== 1) throw new Error('the unblocked arm has no single real read of the private file');
    lines[real] = line;
    return lines.join('\n');
  });

/** Probe 8: the real read replaced by a prose mention of the private file. */
export const proseMention = (pinned: Map<string, Buffer>) => replacedRead(pinned, 'the app read /work/dummy-canary.txt');
/** Probe 9: the real read replaced by a failed open of it. */
export const failedOpen = (pinned: Map<string, Buffer>) =>
  replacedRead(pinned, '[pid    12] openat(AT_FDCWD</app>, "/work/dummy-canary.txt", O_RDONLY) = -1 EACCES (Permission denied)');
/** Probe 10: the real read replaced by an open of a same-named file in another directory. */
export const otherDirectory = (pinned: Map<string, Buffer>) =>
  replacedRead(pinned, '[pid    12] openat(AT_FDCWD</app>, "/tmp/dummy-canary.txt", O_RDONLY) = 14</tmp/dummy-canary.txt>');
