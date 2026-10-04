/**
 * CIT-306: stable identities for the recorded CIT-294 history
 * #117 -> review 1 -> #118 -> review 2 -> #120 -> review 3 -> #120 follow-up.
 *
 * Everything here names something that already exists in the pinned evidence
 * bundle (`tutorial-app/evidence/cit-294-review-history-v1/`). Nothing is
 * resolved here: reading bytes belongs to the artifact resolver (CIT-253), and
 * moving through frames belongs to the playback controller (CIT-300).
 */

export const REVIEW_HISTORY_RECORDING_ID = 'cit-294-review-history-v1';
export const REVIEW_HISTORY_RUN_ID = 'cit-294-117-118-120';
export const REVIEW_HISTORY_BUNDLE_PATH = 'tutorial-app/evidence/cit-294-review-history-v1';

/**
 * One frame per recorded checkpoint, in logical order. These are checkpoints
 * (a question, a claimed result, a review, a correction, a merge), not wire
 * exchanges: nothing here invents an ACP request, response or timing around
 * them. Questions and reviews come from the `client` side, results and
 * corrections from the `agent` side, as in the ghost-trace recording.
 */
export const FRAME_IDS = {
  q0: 'q0-question',
  s1: 's1-claimed-result',
  r1: 'r1-review',
  s2: 's2-correction',
  r2: 'r2-re-review',
  s3: 's3-correction',
  r3: 'r3-review',
  s4: 's4-follow-up',
  landed: 'landed',
} as const;
export type FrameKey = keyof typeof FRAME_IDS;
export const FRAME_ORDER: readonly FrameKey[] = ['q0', 's1', 'r1', 's2', 'r2', 's3', 'r3', 's4', 'landed'];

/** Meaningful stops, one per frame. A TutorialKit lesson may use only some of them. */
export const BREAKPOINT_IDS: Readonly<Record<FrameKey, string>> = {
  q0: 'question-q0',
  s1: 'claimed-result',
  r1: 'first-review',
  s2: 'first-correction',
  r2: 're-review',
  s3: 'initial-120-correction',
  r3: 'third-review',
  s4: 'final-follow-up',
  landed: 'landed',
};

/** The four checker implementation states. S5 is the merge, not a checker state. */
export type CheckerState = 'S1' | 'S2' | 'S3' | 'S4';

/**
 * `pinned` is the revision every artifact of that state is pinned to. For S1
 * and S2 that is the commit the review cited (`20aafd2`, `8d097c8`), which is
 * not on main; `mergedEquivalent` is the rebased commit that is. The bundle
 * proves their `cit-294/` and `CIT-294.md` trees are identical.
 *
 * S3 and S4 have no reviewed spelling: GitHub re-created both when the stack
 * was merged (committer GitHub, signed), and the commits they replaced are not
 * recorded in any retrieved source. `296ca9f` and `cc23e89` are the only
 * retrievable revisions, so they are the pins.
 */
export const REVISIONS: Readonly<Record<CheckerState, {
  pr: number;
  frame: FrameKey;
  pinned: string;
  mergedEquivalent: string | null;
  label: string;
}>> = {
  S1: { pr: 117, frame: 's1', pinned: '20aafd26372a832224be824f72f4a615ee671094', mergedEquivalent: '390a7873ea6fd639c1c735393848e03b05031cc3', label: '#117 as reviewed' },
  S2: { pr: 118, frame: 's2', pinned: '8d097c8e16bd1db44d5d4f558ad99938585e1001', mergedEquivalent: '9739b539de26919f1d1bb8129df8954de40dbfcd', label: '#118 as reviewed' },
  S3: { pr: 120, frame: 's3', pinned: '296ca9f87ea04809b4d21da5bd4d617784856c27', mergedEquivalent: null, label: 'first commit of #120' },
  S4: { pr: 120, frame: 's4', pinned: 'cc23e89297855dd07b1ee477ced455ab46a94738', mergedEquivalent: null, label: 'head of #120 (the final follow-up)' },
};
export const MERGE_COMMIT = 'bc97c0e62fba3e66458e6b663ef4df5da37ebc31';

const CHECKER_DIR = 'docs/investigations/CIT-265/cit-294';
const LESSON_DIR = 'tutorial-app/src/content/tutorial/part-4/rails-matlab-canary';
const inChecker = (name: string) => `${CHECKER_DIR}/${name}`;

export const ARMS = ['mat-unblocked', 'mat-blocked', 'png-unblocked', 'png-blocked'] as const;
export type Arm = (typeof ARMS)[number];

export const PATHS = {
  writeUp: 'docs/investigations/CIT-265/CIT-294.md',
  reconcile: inChecker('Reconcile.pkl'),
  tests: inChecker('cit294.test.pkl'),
  runArms: inChecker('run_arms.sh'),
  observationSchema: inChecker('Observation.pkl'),
  claims: inChecker('Claims.pkl'),
  diagnose: inChecker('diagnose.pkl'),
  diagnosticsReport: inChecker('reports/diagnostics.json'),
  junitReport: inChecker('reports/cit294.test.xml'),
  trace: inChecker('canary-reads.txt'),
  observation: (arm: Arm) => inChecker(`observations/${arm}.json`),
  lesson: `${LESSON_DIR}/1-the-check-that-finally-checks/content.mdx`,
  lessonMeta: `${LESSON_DIR}/meta.md`,
} as const;

/**
 * Texts that did not come out of a git revision: connector output saved by
 * hand, raw commit objects, and facts derived by the collector. `availableAt`
 * is the frame at which the thing the text records exists, so a text can never
 * be offered before the event it describes.
 */
export type CaptureKey =
  | 'q0Description' | 'review1' | 'review2' | 'pr117' | 'pr118' | 'pr120'
  | 'commitS1' | 'commitS2' | 'commitS3' | 'commitS4' | 'commitMerge'
  | 'gitLanding' | 'apiLanding' | 'review3Check';

const capture = (captureId: string, file: string, availableAt: FrameKey) => ({
  captureId,
  file,
  path: `${REVIEW_HISTORY_BUNDLE_PATH}/captures/${file}`,
  availableAt,
});
const commitCapture = (state: CheckerState, frame: FrameKey) =>
  capture(`git:commit-object:${REVISIONS[state].pinned}`, `git-commit-object-${REVISIONS[state].pinned}.txt`, frame);

export const CAPTURES: Readonly<Record<CaptureKey, { captureId: string; file: string; path: string; availableAt: FrameKey }>> = {
  q0Description: capture('linear:CIT-294:description', 'linear-CIT-294-description.md', 'q0'),
  review1: capture('linear:CIT-294:comment:97e70a90', 'linear-CIT-294-comment-97e70a90.md', 'r1'),
  review2: capture('linear:CIT-297:comment:271bc302', 'linear-CIT-297-comment-271bc302.md', 'r2'),
  pr117: capture('github:pr:117:body', 'github-pr-117-body.md', 's1'),
  pr118: capture('github:pr:118:body', 'github-pr-118-body.md', 's2'),
  pr120: capture('github:pr:120:body', 'github-pr-120-body.md', 's3'),
  commitS1: commitCapture('S1', 's1'),
  commitS2: commitCapture('S2', 's2'),
  commitS3: commitCapture('S3', 's3'),
  commitS4: commitCapture('S4', 's4'),
  commitMerge: capture(`git:commit-object:${MERGE_COMMIT}`, `git-commit-object-${MERGE_COMMIT}.txt`, 'landed'),
  gitLanding: capture('git:landing-facts', 'git-landing-facts.json', 'landed'),
  apiLanding: capture('api:landing-facts', 'api-landing-facts.json', 'landed'),
  // A record of where review 3's text was looked for and not found. It exists as a
  // record at the review-3 frame: the absence is what that frame is about.
  review3Check: capture('cit-306:review-3-retrieval-check', 'review-3-retrieval-check.json', 'r3'),
};

/** Where an evidence reference reads from: a file at a pinned revision, or a saved capture. */
export type FileSource = { kind: 'file'; state: CheckerState; path: string };
export type CaptureSource = { kind: 'capture'; key: CaptureKey };
export type Source = FileSource | CaptureSource;

export const sourcePath = (source: Source): string => (source.kind === 'file' ? source.path : CAPTURES[source.key].path);
export const sourceAvailableAt = (source: Source): FrameKey =>
  source.kind === 'file' ? REVISIONS[source.state].frame : CAPTURES[source.key].availableAt;
