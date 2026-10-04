import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isMissing } from './build';
import {
  CAPTURES,
  EVALUATION_SPECS,
  FRAME_ORDER,
  FRAME_SPECS,
  PATHS,
  QUESTION_ORDER,
  REVIEW_HISTORY_EVIDENCE_SPECS,
  REVIEW_HISTORY_QUESTIONS,
  REVISIONS,
  type CheckerState,
} from './index';
import { sourceAvailableAt, type Source } from './identity';

/**
 * CIT-306: the pinned evidence bundle. The bundle is hash-checked here without
 * git, so this runs on any checkout (including CI's shallow one). The checks
 * that compare it with git objects run only where those objects exist.
 */

const bundleDir = fileURLToPath(new URL('../../../evidence/cit-294-review-history-v1/', import.meta.url));
const read = (rel: string) => readFileSync(join(bundleDir, rel));

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
/** git object id, SHA-1 object format: sha1("<type> <length>\0" + bytes). */
const objectId = (type: string, bytes: Buffer) =>
  createHash('sha1').update(Buffer.concat([Buffer.from(`${type} ${bytes.length}\0`), bytes])).digest('hex');
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

type ManifestFile = { state: string; revision: string; path: string; blobId: string; sha256: string; bytes: number; file: string };
type ManifestCapture = { captureId: string; file: string; kind: string; sha256: string; bytes: number; commitId?: string };
type CommitFacts = { sha: string; author: string; committer: string; signed: boolean; rewrittenByGitHub: boolean; parent: string | null; reachableFromMain: boolean };
type Manifest = {
  files: ManifestFile[];
  captures: ManifestCapture[];
  revisions: Record<string, {
    reviewed?: CommitFacts; merged?: CommitFacts; commit?: CommitFacts; pinned: string;
    patchId?: { reviewed: string; merged: string };
    treeEquality?: Array<{ path: string; kind: string; reviewed: string; merged: string; equal: boolean }>;
    counts?: { facts: number; examples: number };
    originalSha?: string | null;
  }>;
};
const manifest = JSON.parse(read('manifest.json').toString('utf8')) as Manifest;

const fileEntry = (state: CheckerState, path: string) => {
  const entry = manifest.files.find((f) => f.revision === REVISIONS[state].pinned && f.path === path);
  if (!entry) throw new Error(`no bundled file for ${state} ${path}`);
  return entry;
};
const bytesOf = (source: Source): Buffer =>
  source.kind === 'file' ? read(fileEntry(source.state, source.path).file) : read(`captures/${CAPTURES[source.key].file}`);
const textOf = (source: Source) => bytesOf(source).toString('utf8');
const linesOf = (text: string) => (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name: string) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

describe('pinned evidence bundle: integrity', () => {
  it('every bundled file hashes to its recorded git blob id, sha256 and length', () => {
    expect(manifest.files.length).toBeGreaterThan(40);
    for (const f of manifest.files) {
      const bytes = read(f.file);
      expect(objectId('blob', bytes), f.file).toBe(f.blobId);
      expect(sha256(bytes), f.file).toBe(f.sha256);
      expect(bytes.length, f.file).toBe(f.bytes);
    }
  });

  it('every capture hashes to its recorded sha256, and each raw commit object hashes to the commit id it names', () => {
    for (const c of manifest.captures) {
      const bytes = read(c.file);
      expect(sha256(bytes), c.file).toBe(c.sha256);
      expect(bytes.length, c.file).toBe(c.bytes);
      if (c.kind === 'git-commit-object') {
        expect(objectId('commit', bytes), `${c.file} is the commit object ${c.commitId}`).toBe(c.commitId);
      }
    }
  });

  it('lists everything under files/ and captures/, and nothing else is there', () => {
    const listed = new Set([...manifest.files.map((f) => f.file), ...manifest.captures.map((c) => c.file)]);
    const onDisk = [...walk(join(bundleDir, 'files')), ...walk(join(bundleDir, 'captures'))].map((p) => relative(bundleDir, p));
    expect(onDisk.sort()).toEqual([...listed].sort());
  });

  it('resolves every capture the recording names, to the capture id the recording carries', () => {
    for (const [key, capture] of Object.entries(CAPTURES)) {
      const entry = manifest.captures.find((c) => c.file === `captures/${capture.file}`);
      expect(entry, key).toBeDefined();
      expect(entry?.captureId, key).toBe(capture.captureId);
    }
  });
});

describe('pinned evidence bundle: identity of the four states', () => {
  const rev = (state: string) => manifest.revisions[state];

  it('pins S1 and S2 to the commits the reviews cite and records the merged equivalents', () => {
    expect(rev('S1').reviewed?.sha).toBe('20aafd26372a832224be824f72f4a615ee671094');
    expect(rev('S1').merged?.sha).toBe('390a7873ea6fd639c1c735393848e03b05031cc3');
    expect(rev('S2').reviewed?.sha).toBe('8d097c8e16bd1db44d5d4f558ad99938585e1001');
    expect(rev('S2').merged?.sha).toBe('9739b539de26919f1d1bb8129df8954de40dbfcd');
    for (const state of ['S1', 'S2'] as const) {
      expect(REVISIONS[state].pinned).toBe(rev(state).reviewed?.sha);
      expect(REVISIONS[state].mergedEquivalent).toBe(rev(state).merged?.sha);
    }
  });

  it('shows the reviewed and merged commits carry the same change: equal patch ids and identical trees', () => {
    for (const state of ['S1', 'S2']) {
      expect(rev(state).patchId?.reviewed).toBe(rev(state).patchId?.merged);
      expect(rev(state).treeEquality?.length).toBe(2);
      for (const t of rev(state).treeEquality ?? []) {
        expect(t.reviewed, `${state} ${t.path}`).toBe(t.merged);
        expect(t.equal).toBe(true);
      }
    }
  });

  it('says which commits are original and which GitHub re-created when the stack merged', () => {
    for (const state of ['S1', 'S2']) {
      const { reviewed, merged } = rev(state);
      expect(reviewed).toMatchObject({ committer: 'Null Hype', signed: false, rewrittenByGitHub: false, reachableFromMain: false });
      expect(merged).toMatchObject({ committer: 'GitHub', signed: true, rewrittenByGitHub: true, reachableFromMain: true });
    }
    for (const state of ['S3', 'S4']) {
      expect(rev(state).commit).toMatchObject({ committer: 'GitHub', signed: true, rewrittenByGitHub: true, reachableFromMain: true });
      // No reviewed spelling is recorded, and the manifest says so rather than guessing.
      expect(rev(state).originalSha).toBeNull();
      expect(REVISIONS[state as CheckerState].mergedEquivalent).toBeNull();
    }
    expect(rev('S3').commit?.sha).toBe(REVISIONS.S3.pinned);
    expect(rev('S4').commit?.sha).toBe(REVISIONS.S4.pinned);
  });

  it('chains the four states: each reviewed commit’s parent is the previous reviewed commit', () => {
    expect(rev('S1').reviewed?.parent).toBe('e69901f6cec1c61d7e27a4cf6f91fc0f7f7c165a');
    expect(rev('S2').reviewed?.parent).toBe(REVISIONS.S1.pinned);
    expect(rev('S3').commit?.parent).toBe(REVISIONS.S2.mergedEquivalent);
    expect(rev('S4').commit?.parent).toBe(REVISIONS.S3.pinned);
  });

  it('shows what landed on main is exactly S4: the merge commit and the S4 commit carry the same tree', () => {
    const treeOf = (raw: string) => /^tree ([0-9a-f]{40})$/m.exec(raw)?.[1];
    const merge = textOf({ kind: 'capture', key: 'commitMerge' });
    const s4 = textOf({ kind: 'capture', key: 'commitS4' });
    expect(treeOf(merge)).toBeDefined();
    expect(treeOf(merge)).toBe(treeOf(s4));
    expect(merge).toMatch(new RegExp(`^parent ${REVISIONS.S4.pinned}$`, 'm'));
  });

  it('recounts the fact totals from the bundled bytes: 8, 18, 25 and 29, matching the retained JUnit reports', () => {
    const count = (state: CheckerState) => {
      let section: 'facts' | 'examples' | null = null;
      const counts = { facts: 0, examples: 0 };
      for (const line of textOf({ kind: 'file', state, path: PATHS.tests }).split('\n')) {
        if (/^facts \{/.test(line)) section = 'facts';
        else if (/^examples \{/.test(line)) section = 'examples';
        else if (section && /^ {2}\["/.test(line)) counts[section] += 1;
      }
      return counts;
    };
    expect(['S1', 'S2', 'S3', 'S4'].map((s) => count(s as CheckerState).facts)).toEqual([8, 18, 25, 29]);
    for (const state of ['S1', 'S2', 'S3', 'S4'] as const) expect(rev(state).counts).toEqual(count(state));
    // S1 retained no report, so its totals rest on the write-up and on review 1 re-running the suite.
    for (const state of ['S2', 'S3', 'S4'] as const) {
      const header = textOf({ kind: 'file', state, path: PATHS.junitReport }).split('\n')[1];
      const { facts, examples } = count(state);
      expect(header).toContain(`tests="${facts + examples}"`);
      expect(header).toContain('failures="0"');
    }
    expect(manifest.files.some((f) => f.state === 'S1' && f.path === PATHS.junitReport)).toBe(false);
  });

  it('retains an empty detector output at S2, S3 and S4, byte for byte the same file', () => {
    const entries = (['S2', 'S3', 'S4'] as const).map((state) => fileEntry(state, PATHS.diagnosticsReport));
    expect(new Set(entries.map((e) => e.blobId)).size).toBe(1);
    for (const state of ['S2', 'S3', 'S4'] as const) {
      const report = JSON.parse(textOf({ kind: 'file', state, path: PATHS.diagnosticsReport })) as Record<string, unknown[]>;
      expect(Object.keys(report)).toEqual(['mat-unblocked', 'mat-blocked', 'png-unblocked', 'png-blocked']);
      for (const flags of Object.values(report)) expect(flags).toEqual([]);
    }
  });

  it('shows the final follow-up never touched the lesson page, and that the page makes the claim review 3 contradicts', () => {
    const landing = JSON.parse(textOf({ kind: 'capture', key: 'gitLanding' })) as Record<string, unknown>;
    expect(landing.lessonBlobAtS3).toBe(landing.lessonBlobAtS4);
    expect(fileEntry('S3', PATHS.lesson).blobId).toBe(landing.lessonBlobAtS3);
    expect(fileEntry('S4', PATHS.lesson).blobId).toBe(landing.lessonBlobAtS4);
    expect(normalize(textOf({ kind: 'file', state: 'S3', path: PATHS.lesson }))).toContain(
      'so a deleted or forged trace changes what gets computed',
    );
    expect(landing.tutorialPagePresent).toEqual({ S1: false, S2: false, S3: true, S4: true });
  });
});

describe('pinned evidence bundle: every reference points at what it says', () => {
  const captured = REVIEW_HISTORY_EVIDENCE_SPECS.filter((e) => !isMissing(e.spec));

  it('declares a substantial, unique set of evidence', () => {
    expect(REVIEW_HISTORY_EVIDENCE_SPECS.length).toBeGreaterThan(100);
    expect(new Set(REVIEW_HISTORY_EVIDENCE_SPECS.map((e) => e.evidenceId)).size).toBe(REVIEW_HISTORY_EVIDENCE_SPECS.length);
  });

  it('every range exists in the pinned bytes and holds its verbatim anchor', () => {
    for (const { evidenceId, spec } of captured) {
      if (isMissing(spec)) continue;
      const lines = linesOf(textOf(spec.source));
      const [from, to] = spec.lines;
      expect(from, evidenceId).toBeGreaterThanOrEqual(1);
      expect(to, evidenceId).toBeGreaterThanOrEqual(from);
      expect(to, `${evidenceId} is past the end of the file (${lines.length} lines)`).toBeLessThanOrEqual(lines.length);
      expect(lines.slice(from - 1, to).join('\n'), `${evidenceId} lines ${from}-${to} should contain ${JSON.stringify(spec.anchor)}`).toContain(spec.anchor);
    }
  });

  it('offers nothing before the thing it records exists', () => {
    const index = (frame: string) => FRAME_ORDER.indexOf(frame as (typeof FRAME_ORDER)[number]);
    for (const { evidenceId, spec } of REVIEW_HISTORY_EVIDENCE_SPECS) {
      if (isMissing(spec)) continue;
      expect(index(spec.at), `${evidenceId} is offered at ${spec.at} but its source exists only at ${sourceAvailableAt(spec.source)}`).toBeGreaterThanOrEqual(index(sourceAvailableAt(spec.source)));
    }
    // What an evaluation shows at its own frame (subject, related) cannot come from later.
    for (const evaluation of EVALUATION_SPECS) {
      for (const location of [evaluation.subject, ...evaluation.related]) {
        expect(index(sourceAvailableAt(location.source)), `${evaluation.id}: ${location.detail}`).toBeLessThanOrEqual(index(evaluation.frame));
      }
    }
  });

  it('every evaluation quotes its message verbatim from a retrieved source, except the one sentence that is CIT-306’s own', () => {
    for (const evaluation of EVALUATION_SPECS) {
      if (evaluation.id === 'landed.history') continue;
      const sources = evaluation.evidence.filter((e) => !isMissing(e)).map((e) => (isMissing(e) ? '' : normalize(textOf(e.source))));
      expect(sources.some((text) => text.includes(normalize(evaluation.message))), `${evaluation.id} message is not verbatim in any of its evidence`).toBe(true);
    }
  });

  it('quotes each question’s recorded wording verbatim from its source, and keeps the framing separate', () => {
    for (const id of QUESTION_ORDER) {
      const question = REVIEW_HISTORY_QUESTIONS[id];
      const text = textOf({ kind: 'capture', key: question.source });
      const found = id === 'Q0' ? text.includes(question.recorded) : normalize(text).includes(normalize(question.recorded));
      expect(found, `${id} recorded wording is not verbatim in ${question.source}`).toBe(true);
      // Only Q0 has no editorial framing; Q1 to Q3 carry CIT-305's, labelled as such in the pin.
      expect(question.framing === null).toBe(id === 'Q0');
    }
    expect(REVIEW_HISTORY_QUESTIONS.Q3.secondHand).toBe(true);
    expect(REVIEW_HISTORY_QUESTIONS.Q1.secondHand).toBe(false);
  });

  it('quotes each review’s recommendation verbatim', () => {
    const verdictOf = (frame: string) => FRAME_SPECS.find((s) => s.key === frame)?.verdict?.text ?? '';
    expect(textOf({ kind: 'capture', key: 'review1' })).toContain(verdictOf('r1'));
    expect(textOf({ kind: 'capture', key: 'review2' })).toContain(verdictOf('r2'));
  });

  it('matches the first review’s own citations: the ranges it links are the ranges the recording cites', () => {
    const review = textOf({ kind: 'capture', key: 'review1' });
    for (const [needle, lines] of [
      ['run_arms.sh#L21-L30', [21, 30]], ['cit294.test.pkl#L27-L33', [27, 33]], ['Reconcile.pkl#L35-L39', [35, 39]], ['CIT-294.md#L249-L254', [249, 254]],
    ] as const) {
      expect(review).toContain(needle);
      const cited = REVIEW_HISTORY_EVIDENCE_SPECS.find(({ spec }) => !isMissing(spec) && spec.lines[0] === lines[0] && spec.lines[1] === lines[1] && spec.source.kind === 'file' && spec.source.state === 'S1');
      expect(cited, `the recording cites ${needle}`).toBeDefined();
    }
    const second = textOf({ kind: 'capture', key: 'review2' });
    for (const [needle, lines] of [['cit294.test.pkl#L98-L104', [98, 104]], ['cit294.test.pkl#L55-L63', [55, 63]]] as const) {
      expect(second).toContain(needle);
      expect(REVIEW_HISTORY_EVIDENCE_SPECS.some(({ spec }) => !isMissing(spec) && spec.lines[0] === lines[0] && spec.lines[1] === lines[1] && spec.source.kind === 'file' && spec.source.state === 'S2')).toBe(true);
    }
  });
});

/** True only where the pinned commits exist locally (a full clone that has fetched the reviewed commits). */
const commits = [...new Set(manifest.files.map((f) => f.revision))];
const hasGitObjects = (() => {
  try {
    for (const sha of commits) execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore', cwd: bundleDir });
    return true;
  } catch {
    return false;
  }
})();

describe('pinned evidence bundle: against git objects', () => {
  it.skipIf(!hasGitObjects)('the bundled bytes are the bytes git holds at those revisions (runs where the commits are present)', () => {
    for (const f of manifest.files) {
      const id = execFileSync('git', ['rev-parse', `${f.revision}:${f.path}`], { cwd: bundleDir, encoding: 'utf8' }).trim();
      expect(id, `${f.revision}:${f.path}`).toBe(f.blobId);
    }
  });
});
