import type { InputProvenance } from '../acpReplayContract';
import type { CapturedEvidenceSpec, EvaluationSpec, EvidenceSpec, FrameSpec, Lines, MissingEvidenceSpec } from './build';
import {
  ARMS,
  CAPTURES,
  MERGE_COMMIT,
  PATHS,
  REVISIONS,
  type Arm,
  type CaptureKey,
  type CaptureSource,
  type CheckerState,
  type FileSource,
  type FrameKey,
} from './identity';
import { QUESTION_ORDER, REVIEW_HISTORY_QUESTIONS, questionPin, type QuestionId } from './questions';

/**
 * CIT-306: the recorded 117 -> review -> 118 -> re-review -> 120 -> follow-up
 * history, declared compactly. `recording.ts` turns these into CIT-299's types.
 *
 * Rules the declarations follow, each enforced by `bundle.spec.ts` or
 * `sequence.spec.ts`:
 *
 *   - Wording is the author's or reviewer's own, verbatim from a retrieved
 *     source. Where a reviewer's words are lost it says so and quotes the
 *     second-hand account, labelled.
 *   - A reviewer finding is an evaluation in the `review` channel with recorded
 *     provenance. It is never derived from the retained `diagnostics.json`,
 *     which is `[]` for every arm at every state.
 *   - What answers a finding exists only after the correction, so it is
 *     `evidence` with the correction's `availableAt`. The prefix filter hides
 *     it until the cursor gets there; `related` and `subject` only name
 *     locations that exist at the evaluation's own frame.
 *   - A correction's verdict is `review: pending`. No reviewer ever approved a
 *     later fix, and no review of the final revision is recorded.
 */

const at = (state: CheckerState, path: string): FileSource => ({ kind: 'file', state, path });
const cap = (key: CaptureKey): CaptureSource => ({ kind: 'capture', key });
const recorded = (key: CaptureKey): InputProvenance => ({ kind: 'recorded', captureId: CAPTURES[key].captureId });

type Role = 'subject' | 'related';
const code = (id: string, frame: FrameKey, role: Role, label: string, source: FileSource | CaptureSource, lines: Lines, anchor: string): CapturedEvidenceSpec =>
  ({ id, at: frame, role, kind: 'source', label, source, lines, anchor });
const output = (id: string, frame: FrameKey, role: Role, label: string, source: FileSource | CaptureSource, lines: Lines, anchor: string): CapturedEvidenceSpec =>
  ({ id, at: frame, role, kind: 'captured-execution-output', label, source, lines, anchor });
const prose = (id: string, frame: FrameKey, role: Role, label: string, source: FileSource | CaptureSource, lines: Lines, anchor: string): CapturedEvidenceSpec =>
  ({ id, at: frame, role, kind: 'recorded-review-prose', label, source, lines, anchor });
const gone = (id: string, frame: FrameKey, role: Role, kind: MissingEvidenceSpec['kind'], label: string, missing: string): MissingEvidenceSpec =>
  ({ id, at: frame, role, kind, label, missing });

const flagged = [{ channel: 'review', value: 'flagged' }] as const;
const approved = [{ channel: 'review', value: 'approved' }] as const;
const pending = [{ channel: 'review', value: 'pending' }] as const;

const OBS_LINES: Record<CheckerState, Record<Arm, number>> = {
  S1: { 'mat-unblocked': 16, 'mat-blocked': 14, 'png-unblocked': 13, 'png-blocked': 13 },
  S2: { 'mat-unblocked': 21, 'mat-blocked': 19, 'png-unblocked': 18, 'png-blocked': 18 },
  S3: { 'mat-unblocked': 22, 'mat-blocked': 20, 'png-unblocked': 19, 'png-blocked': 19 },
  S4: { 'mat-unblocked': 22, 'mat-blocked': 20, 'png-unblocked': 19, 'png-blocked': 19 },
};
const TRACE_LINES: Record<CheckerState, number> = { S1: 81, S2: 101, S3: 105, S4: 101 };

/** The monitor: what the four live arms emitted and what strace saw. No verdict of its own. */
const monitor = (state: CheckerState, frame: FrameKey): CapturedEvidenceSpec[] => [
  ...ARMS.map((arm) => output(`obs-${arm}`, frame, 'related', `Observation, ${arm}`, at(state, PATHS.observation(arm)), [1, OBS_LINES[state][arm]], '"arm"')),
  output('trace', frame, 'related', 'strace transcript of the four arms (canary-reads.txt)', at(state, PATHS.trace), [1, TRACE_LINES[state]], '### ARM: mat-unblocked'),
];

/**
 * A Pkl fact and, beside it, the line of the retained JUnit report that lists it as passing.
 * `title` is a prefix of the fact's title. The anchors include the opening `["` and `name="`
 * so that, for example, `blocked MAT canary: independently` cannot also match inside
 * `unblocked MAT canary: independently` and let a wrong range pass.
 */
const fact = (state: CheckerState, id: string, frame: FrameKey, label: string, test: Lines, junit: number, title: string): CapturedEvidenceSpec[] => [
  code(id, frame, 'related', `Check fact: ${label}`, at(state, PATHS.tests), test, `["${title}`),
  output(`${id}.retained`, frame, 'related', `Retained JUnit result for that fact: ${label}`, at(state, PATHS.junitReport), [junit, junit], `name="${title}`),
];

const NOT_CAPTURED_MUTATION = (review: string, what: string) =>
  `${review} made these mutations in temporary copies (${what}). No output of those runs is retained in any retrievable source, so the review text is the only record of the result.`;

export const FRAME_SPECS: readonly FrameSpec[] = [
  {
    key: 'q0', actor: 'client', speaker: 'CIT-294 issue', action: 'pose the original question and criteria (historical issue text)',
    provenance: recorded('q0Description'),
    // No capturedAt: the issue was created 2026-10-03T22:56:40Z, but the text was retrieved afterwards and may have been edited since.
    pins: [questionPin(REVIEW_HISTORY_QUESTIONS.Q0)],
  },
  {
    key: 's1', actor: 'agent', speaker: 'implementer', action: 'claim a result for #117',
    provenance: recorded('commitS1'), capturedAt: '2026-10-04T00:59:46+00:00',
    pins: [{
      id: 'rev-s1', label: 'S1 · #117 as reviewed (checker state 1)',
      text: `${REVISIONS.S1.pinned} — the commit review 1 cites. Merged on main as ${REVISIONS.S1.mergedEquivalent}: same patch, identical cit-294/ and CIT-294.md trees.`,
    }],
  },
  {
    key: 'r1', actor: 'client', speaker: 'reviewer', action: 'review #117 and request changes',
    provenance: recorded('review1'), capturedAt: '2026-10-04T01:15:37.196Z',
    pins: [questionPin(REVIEW_HISTORY_QUESTIONS.Q1)],
    verdict: { channel: 'review', status: 'flagged', text: 'Recommendation: request changes before treating CIT-294 as complete.' },
  },
  {
    key: 's2', actor: 'agent', speaker: 'implementer', action: 'correct per review 1 (#118)',
    provenance: recorded('commitS2'), capturedAt: '2026-10-04T02:06:44+00:00',
    pins: [{
      id: 'rev-s2', label: 'S2 · #118 as reviewed (checker state 2)',
      text: `${REVISIONS.S2.pinned} — the commit review 2 cites. Merged on main as ${REVISIONS.S2.mergedEquivalent}: same patch, identical cit-294/ and CIT-294.md trees.`,
    }],
  },
  {
    key: 'r2', actor: 'client', speaker: 'reviewer', action: 'review #118 and keep changes requested',
    provenance: recorded('review2'), capturedAt: '2026-10-04T02:16:12.197Z',
    pins: [questionPin(REVIEW_HISTORY_QUESTIONS.Q2)],
    verdict: { channel: 'review', status: 'flagged', text: 'Recommendation: keep changes requested.' },
  },
  {
    key: 's3', actor: 'agent', speaker: 'implementer', action: 'correct per review 2 (#120, first commit)',
    provenance: recorded('commitS3'), capturedAt: '2026-10-04T02:53:47+00:00',
    pins: [{
      id: 'rev-s3', label: 'S3 · first commit of #120 (checker state 3)',
      text: `${REVISIONS.S3.pinned} — as GitHub re-created it when the stack was merged (committer GitHub, signed). The commit it replaced is not recorded, so what review 3 saw cannot be compared byte for byte.`,
    }],
  },
  {
    key: 'r3', actor: 'client', speaker: 'reviewer', action: 'review #120 (second-hand account only)',
    // No capturedAt: when review 3 was written is not recorded anywhere retrievable.
    provenance: { kind: 'recorded', captureId: `secondary-account:git-commit-message:${REVISIONS.S4.pinned}` },
    pins: [questionPin(REVIEW_HISTORY_QUESTIONS.Q3)],
    verdict: { channel: 'review', status: 'flagged', text: 'Findings reported second-hand; the review’s recommendation is not retrievable.' },
  },
  {
    key: 's4', actor: 'agent', speaker: 'implementer', action: 'correct per review 3 (#120 head, the final follow-up)',
    provenance: recorded('commitS4'), capturedAt: '2026-10-04T03:27:25+00:00',
    pins: [{
      id: 'rev-s4', label: 'S4 · head of #120 (checker state 4)',
      text: `${REVISIONS.S4.pinned} — as GitHub re-created it when the stack was merged (same caveat as S3). No review of this revision is recorded.`,
    }],
  },
  {
    key: 'landed', actor: 'agent', speaker: 'git', action: 'merge #120 to main',
    provenance: recorded('commitMerge'), capturedAt: '2026-10-04T14:57:33+11:00',
    pins: [{
      id: 'rev-s5', label: 'S5 · merge commit on main',
      text: `${MERGE_COMMIT} — parents be95c86ea1fddd8913cab7577f2405c1a2e90205 (main before) and ${REVISIONS.S4.pinned} (#120 head).`,
    }],
  },
];

// ---------------------------------------------------------------------------
// s1: the claimed result of #117 (checker state 1)

const s1Claim: EvaluationSpec = {
  id: 's1.claim', frame: 's1', code: 's1.claimed-result', severity: 'info',
  message: 'The concrete remaining impact proof CIT-265 named is done: unblocked disclosure, blocked refusal with no disclosure, and normal PNG processing under both blocking states, each bound to its own observation and Pkl record rather than asserted.',
  subject: { role: 'fact', source: at('S1', PATHS.writeUp), line: 249, detail: 'completion claim in the write-up (CIT-294.md)' },
  related: [{ role: 'axiom', source: at('S1', PATHS.reconcile), line: 17, detail: 'the checker as submitted: Reconcile.check at S1' }],
  verdicts: pending, provenance: recorded('commitS1'),
  evidence: [
    code('claim', 's1', 'subject', 'Write-up completion claim', at('S1', PATHS.writeUp), [249, 254], 'remaining impact proof'),
    code('suite-claim', 's1', 'related', 'Write-up suite claim: 8 facts / 28 asserts / 4 examples', at('S1', PATHS.writeUp), [184, 185], '8 facts /'),
    code('pr-claim', 's1', 'related', 'PR #117 test plan: the suite passes', cap('pr117'), [13, 13], 'pkl test cit294.test.pkl'),
    code('checker', 's1', 'related', 'The checker as submitted', at('S1', PATHS.reconcile), [1, 42], 'module cit294.Reconcile'),
    code('checker-tests', 's1', 'related', 'The eight check facts as submitted', at('S1', PATHS.tests), [16, 53], 'facts {'),
    ...monitor('S1', 's1'),
    gone('retained-result', 's1', 'related', 'captured-execution-output', 'Retained authoritative check result and detector output',
      'No JUnit result or detector output is retained at this revision: reports/ does not exist at 20aafd26 (it is added by #118). The green suite exists here only as the write-up’s statement, and review 1 re-ran it itself.'),
  ],
};

// ---------------------------------------------------------------------------
// r1: review 1 of #117 and its four findings

const r1Common = { frame: 'r1' as const, severity: 'error' as const, verdicts: flagged, provenance: recorded('review1') };
const r1Missing = (id: string, what: string) =>
  gone(id, 'r1', 'related', 'captured-execution-output', 'Original mutation output', NOT_CAPTURED_MUTATION('Review 1', what));

const review1Finding1: EvaluationSpec = {
  ...r1Common, id: 'review-1.finding-1', code: 'review-1.finding-1',
  message: 'The independent file-read evidence never reaches the checker.',
  subject: { role: 'observation', source: at('S1', PATHS.runArms), line: 21, detail: 'run_arms.sh:21–30, as cited by review 1: prints filtered strace output that Pkl never consumes' },
  related: [{ role: 'axiom', source: at('S1', PATHS.reconcile), line: 17, detail: 'Reconcile.check at S1 reads no strace-derived field' }],
  evidence: [
    prose('review-text', 'r1', 'subject', 'Review 1, finding 1 (recorded review text)', cap('review1'), [5, 5], 'The independent file-read evidence never reaches the checker.'),
    code('cited-source', 'r1', 'related', 'Source cited by review 1 (run_arms.sh:21–30)', at('S1', PATHS.runArms), [21, 30], 'docker run --rm "${envs[@]}" cit294:live'),
    r1Missing('mutation-output', 'a deleted trace; a dummy-file read forged into the blocked arm'),
    // Answered by #118 (S2):
    code('s2.collector', 's2', 'related', 'S2 change: independent evidence derived outside the Ruby process and merged into each observation', at('S2', PATHS.runArms), [41, 63], 'independent_dummy_file_openat_count: $dummy_count'),
    code('s2.schema', 's2', 'related', 'S2 change: the independent_* fields of the observation schema', at('S2', PATHS.observationSchema), [46, 65], 'independent_dummy_file_openat_count: Int'),
    code('s2.checker', 's2', 'related', 'S2 change: the independent-read check in Reconcile', at('S2', PATHS.reconcile), [91, 101], 'independent-read-mismatch'),
    ...fact('S2', 's2.fact-unblocked', 's2', 'unblocked arm independently confirmed open', [29, 31], 6, 'unblocked MAT canary: independently'),
    ...fact('S2', 's2.fact-blocked', 's2', 'blocked arm independently confirmed never opened', [42, 44], 9, 'blocked MAT canary: independently'),
    ...fact('S2', 's2.control-deleted-trace', 's2', 'negative control, deleted or zeroed independent trace', [98, 101], 19, 'negative control: a deleted/zeroed independent trace'),
    ...fact('S2', 's2.control-forged-read', 's2', 'negative control, trace falsely reporting a dummy-file read', [102, 105], 20, 'negative control: a trace falsely reporting'),
  ],
};

const review1Finding2: EvaluationSpec = {
  ...r1Common, id: 'review-1.finding-2', code: 'review-1.finding-2',
  message: 'A generic variant crash passes as successful blocking.',
  subject: { role: 'axiom', source: at('S1', PATHS.tests), line: 27, detail: 'cit294.test.pkl:27–33, as cited by review 1: checks loader_error from the preliminary Vips probe, not the variant’s error' },
  related: [],
  evidence: [
    prose('review-text', 'r1', 'subject', 'Review 1, finding 2 (recorded review text)', cap('review1'), [7, 7], 'A generic variant crash passes as successful blocking.'),
    code('cited-source', 'r1', 'related', 'Source cited by review 1 (cit294.test.pkl:27–33)', at('S1', PATHS.tests), [27, 33], 'matBlocked.loader_error'),
    r1Missing('mutation-output', 'the variant error changed to RuntimeError: disk full'),
    // Answered by #118 (S2):
    code('s2.checker', 's2', 'related', 'S2 change: the actual variant’s error class and message are checked', at('S2', PATHS.reconcile), [47, 56], 'generic-crash-not-specific-block'),
    ...fact('S2', 's2.fact-variant-error', 's2', 'blocked arm raised the specific block error', [32, 37], 7, 'blocked MAT canary: no loader ran and the *actual variant call*'),
    ...fact('S2', 's2.control-generic-crash', 's2', 'negative control, a generic crash', [76, 81], 15, 'negative control: a generic crash'),
    ...fact('S2', 's2.control-wrong-message', 's2', 'negative control, right error class with an unrelated message', [82, 86], 16, 'negative control: the right error class'),
  ],
};

const review1Finding3: EvaluationSpec = {
  ...r1Common, id: 'review-1.finding-3', code: 'review-1.finding-3',
  message: 'Byte recovery is trusted through a boolean.',
  subject: { role: 'axiom', source: at('S1', PATHS.reconcile), line: 35, detail: 'Reconcile.pkl:35–39, as cited by review 1: accepts matches_dummy_file=true without validating the returned bytes or count' },
  related: [{ role: 'observation', source: at('S1', PATHS.observation('mat-unblocked')), line: 13, detail: 'the unblocked arm’s own self-report, including matches_dummy_file' }],
  evidence: [
    prose('review-text', 'r1', 'subject', 'Review 1, finding 3 (recorded review text)', cap('review1'), [9, 9], 'Byte recovery is trusted through a boolean.'),
    code('cited-source', 'r1', 'related', 'Source cited by review 1 (Reconcile.pkl:35–39)', at('S1', PATHS.reconcile), [35, 39], 'matches_dummy_file'),
    output('observed-self-report', 'r1', 'related', 'The unblocked arm’s own self-report, boolean and raw bytes', at('S1', PATHS.observation('mat-unblocked')), [1, 16], 'matches_dummy_file'),
    r1Missing('mutation-output', 'emptied returned pixels with the count set to zero; the blocked PNG control’s pixels changed to ffffffff'),
    // Answered by #118 (S2):
    code('s2.checker-bytes', 's2', 'related', 'S2 change: returned bytes and count checked against pinned values', at('S2', PATHS.reconcile), [60, 70], 'returned-bytes-mismatch'),
    code('s2.checker-consistency', 's2', 'related', 'S2 change: the boolean is checked against the raw bytes it describes', at('S2', PATHS.reconcile), [80, 90], 'self-report-inconsistent'),
    ...fact('S2', 's2.fact-exact-bytes', 's2', 'the 32 canary bytes and their count are recovered', [24, 28], 5, 'unblocked MAT canary: the dummy file'),
    ...fact('S2', 's2.fact-png-exact', 's2', 'PNG control pixels are byte-exact in both blocking states', [45, 54], 10, 'PNG control processes normally whether or not untrusted loaders are blocked, with byte-exact'),
    ...fact('S2', 's2.control-emptied', 's2', 'negative control, emptied bytes and count', [87, 93], 17, 'negative control: emptying'),
    ...fact('S2', 's2.control-corrupted-png', 's2', 'negative control, corrupted PNG control pixels', [94, 97], 18, 'negative control: corrupting'),
  ],
};

const review1Finding4: EvaluationSpec = {
  ...r1Common, id: 'review-1.finding-4', code: 'review-1.finding-4',
  message: 'The tutorial/report acceptance step is missing.',
  subject: { role: 'fact', source: at('S1', PATHS.writeUp), line: 249, detail: 'CIT-294.md:249–254, as cited by review 1: the completion claim, made before the tutorial/report step exists' },
  related: [],
  evidence: [
    prose('review-text', 'r1', 'subject', 'Review 1, finding 4 (recorded review text)', cap('review1'), [11, 11], 'The tutorial/report acceptance step is missing.'),
    code('cited-source', 'r1', 'related', 'Write-up completion claim cited by review 1 (CIT-294.md:249–254)', at('S1', PATHS.writeUp), [249, 254], 'remaining impact proof'),
    gone('absent-reports', 'r1', 'related', 'captured-execution-output', 'Retained detector output and authoritative check result',
      'None is retained at 20aafd26: reports/ does not exist at that revision, so the write-up’s “actual detector output” is prose only.'),
    // Answered in part by #118 (S2): the retained reports. No TutorialKit page exists at S2.
    code('s2.diagnose', 's2', 'related', 'S2 change: diagnose.pkl, the detector invocation', at('S2', PATHS.diagnose), [1, 29], 'module cit294.diagnose'),
    code('s2.reports-run', 's2', 'related', 'S2 change: run_arms.sh writes the reports', at('S2', PATHS.runArms), [75, 80], 'pkl test --junit-reports'),
    output('s2.diagnostics-report', 's2', 'related', 'Retained detector output (an empty list for every arm)', at('S2', PATHS.diagnosticsReport), [1, 6], '"mat-unblocked": []'),
    output('s2.junit-report', 's2', 'related', 'Retained authoritative check result: 22 tests, 0 failures', at('S2', PATHS.junitReport), [2, 2], 'tests="22"'),
  ],
};

// ---------------------------------------------------------------------------
// s2: the claimed fix in #118 (checker state 2)

const s2Claim: EvaluationSpec = {
  id: 's2.claim', frame: 's2', code: 's2.claimed-fix', severity: 'info',
  message: 'Each of the review\'s 5 exact mutations, reproduced against the real `observations/*.json` in a scratch copy (not inline Pkl literals), now fails the suite; restoring the originals still passes 100%',
  subject: { role: 'fact', source: cap('pr118'), line: 17, detail: 'PR #118 test plan' },
  related: [{ role: 'axiom', source: at('S2', PATHS.reconcile), line: 91, detail: 'Reconcile.pkl source comment making the same claim about the independent-read check' }],
  verdicts: pending, provenance: recorded('commitS2'),
  evidence: [
    code('pr-claim', 's2', 'subject', 'PR #118 test plan: the claim', cap('pr118'), [17, 17], 'Each of the review\'s 5 exact mutations'),
    code('pr-claim-1', 's2', 'related', 'PR #118 summary, item 1', cap('pr118'), [5, 5], 'is now flagged'),
    code('source-comment', 's2', 'related', 'The same claim in the Reconcile.pkl source comment', at('S2', PATHS.reconcile), [91, 94], 'can no longer pass silently'),
    output('diagnostics-report', 's2', 'related', 'Retained detector output (an empty list for every arm)', at('S2', PATHS.diagnosticsReport), [1, 6], '"mat-unblocked": []'),
    output('junit-report', 's2', 'related', 'Retained authoritative check result: 22 tests, 0 failures', at('S2', PATHS.junitReport), [2, 2], 'tests="22"'),
    ...monitor('S2', 's2'),
  ],
};

// ---------------------------------------------------------------------------
// r2: review 2 of #118: three gaps, and two earlier findings reassessed as fixed

const r2Common = { frame: 'r2' as const, severity: 'error' as const, verdicts: flagged, provenance: recorded('review2') };
const r2Missing = (what: string) => gone('mutation-output', 'r2', 'related', 'captured-execution-output', 'Original mutation output', NOT_CAPTURED_MUTATION('Review 2', what));

const review2Gap1: EvaluationSpec = {
  ...r2Common, id: 'review-2.gap-1', code: 'review-2.gap-1',
  message: 'The trace negative controls mutate the derived count, not the retained trace.',
  subject: { role: 'axiom', source: at('S2', PATHS.tests), line: 98, detail: 'cit294.test.pkl:98–104, as cited by review 2: changes independent_dummy_file_openat_count, not the retained trace' },
  related: [{ role: 'fact', source: cap('pr118'), line: 17, detail: 'the PR #118 claim review 2 calls inaccurate' }],
  evidence: [
    prose('review-text', 'r2', 'subject', 'Review 2, gap 1 (recorded review text)', cap('review2'), [7, 7], 'The trace negative controls mutate the derived count, not the retained trace.'),
    code('cited-source', 'r2', 'related', 'Source cited by review 2 (cit294.test.pkl:98–104)', at('S2', PATHS.tests), [98, 104], 'independent_dummy_file_openat_count = 0'),
    code('disputed-claim', 'r2', 'related', 'The claim review 2 disputes (PR #118 test plan)', cap('pr118'), [17, 17], 'Each of the review\'s 5 exact mutations'),
    r2Missing('deleting canary-reads.txt; replacing it with a blocked-arm dummy-file read'),
    // Answered by the first commit of #120 (S3):
    code('s3.schema', 's3', 'related', 'S3 change: the retained trace is embedded in each observation', at('S3', PATHS.observationSchema), [54, 64], 'independent_trace_text: String'),
    code('s3.collector', 's3', 'related', 'S3 change: run_arms.sh retains the trace text and merges it', at('S3', PATHS.runArms), [38, 72], 'independent_trace_text: $trace_text'),
    code('s3.checker-derive', 's3', 'related', 'S3 change: the open count is re-derived from the trace text (a substring match)', at('S3', PATHS.reconcile), [24, 31], 'line.contains("dummy-canary.txt")'),
    code('s3.checker-compare', 's3', 'related', 'S3 change: trace-text check and trace-count-mismatch', at('S3', PATHS.reconcile), [100, 122], 'trace-count-mismatch'),
    ...fact('S3', 's3.fact-trace-unblocked', 's3', 'unblocked arm’s retained trace shows the open', [32, 35], 7, 'unblocked MAT canary: the retained trace text'),
    ...fact('S3', 's3.fact-trace-blocked', 's3', 'blocked arm’s retained trace has no dummy-file open', [49, 51], 11, 'blocked MAT canary: the retained trace text'),
    ...fact('S3', 's3.control-count-zeroed', 's3', 'the S2 count control, relabelled: zeroing the int is a self-inconsistency', [115, 118], 22, 'negative control: zeroing the convenience int'),
    ...fact('S3', 's3.control-count-inflated', 's3', 'the S2 count control, relabelled: inflating the int', [119, 122], 23, 'negative control: inflating the convenience int'),
    ...fact('S3', 's3.control-deleted-trace', 's3', 'negative control, actually deleting the retained trace text', [123, 126], 24, 'negative control: actually deleting the retained trace text'),
    ...fact('S3', 's3.control-forged-trace', 's3', 'negative control, forging a dummy-file open into the blocked arm’s trace', [127, 131], 25, 'negative control: forging a dummy-file openat line'),
  ],
};

const review2Gap2: EvaluationSpec = {
  ...r2Common, id: 'review-2.gap-2', code: 'review-2.gap-2',
  message: 'Input/configuration identity is recorded but incompletely checked.',
  subject: { role: 'axiom', source: at('S2', PATHS.tests), line: 60, detail: 'cit294.test.pkl:55–63, as cited by review 2 (the configuration fact): checks only the unblocked MAT arm' },
  related: [{ role: 'axiom', source: at('S2', PATHS.observationSchema), line: 54, detail: 'the source SHA is constrained to a valid shape only' }],
  evidence: [
    prose('review-text', 'r2', 'subject', 'Review 2, gap 2 (recorded review text)', cap('review2'), [9, 9], 'Input/configuration identity is recorded but incompletely checked.'),
    code('cited-source', 'r2', 'related', 'Source cited by review 2 (cit294.test.pkl:55–63)', at('S2', PATHS.tests), [55, 63], 'matUnblocked.independent_rails_load_defaults'),
    code('shape-only-sha', 'r2', 'related', 'The source SHA is only shape-checked', at('S2', PATHS.observationSchema), [54, 54], 'independent_source_sha256: String(matches(Regex'),
    r2Missing('the blocked arm’s source SHA replaced by a different valid SHA; its Rails defaults changed to 6.1 and processor to mini_magick'),
    // Answered by the first commit of #120 (S3):
    code('s3.claims-pinned', 's3', 'related', 'S3 change: Claims pin the source hash and runtime config for every arm', at('S3', PATHS.claims), [48, 74], 'expectedSourceSha256'),
    code('s3.checker-identity', 's3', 'related', 'S3 change: source-identity-mismatch and runtime-config-mismatch', at('S3', PATHS.reconcile), [123, 140], 'source-identity-mismatch'),
    ...fact('S3', 's3.fact-config-every-arm', 's3', 'runtime configuration checked for every arm', [67, 76], 14, 'the runtime configuration each verdict is bound to'),
    ...fact('S3', 's3.fact-same-source', 's3', 'each blocked/unblocked pair uploaded the identical source file', [77, 80], 15, 'each blocked/unblocked pair uploaded the identical source file'),
    ...fact('S3', 's3.control-source-drift', 's3', 'negative control, blocked arm against a different source file', [132, 136], 26, 'negative control: the blocked MAT arm silently running against a different'),
    ...fact('S3', 's3.control-config-drift', 's3', 'negative control, blocked arm under a different Rails configuration', [137, 143], 27, 'negative control: the blocked MAT arm silently running under a different'),
  ],
};

const review2Gap3: EvaluationSpec = {
  ...r2Common, id: 'review-2.gap-3', code: 'review-2.gap-3',
  message: 'The tutorial/report acceptance requirement remains open.',
  subject: { role: 'fact', source: cap('q0Description'), line: 25, detail: 'CIT-294’s own requirement: make the real run inspectable from the existing tutorial/report pattern' },
  related: [],
  evidence: [
    prose('review-text', 'r2', 'subject', 'Review 2, gap 3 (recorded review text)', cap('review2'), [11, 11], 'The tutorial/report acceptance requirement remains open.'),
    code('requirement', 'r2', 'related', 'The requirement, as written in the issue (Q0)', cap('q0Description'), [25, 25], 'Make the real run inspectable'),
    gone('absent-tutorial-page', 'r2', 'related', 'source', 'TutorialKit page for this case',
      'No page exists at 8d097c8e: tutorial-app/src/content/tutorial/part-4/rails-matlab-canary is absent from that revision (recorded by the bundle collector).'),
    // Answered by the first commit of #120 (S3):
    code('s3.lesson', 's3', 'related', 'S3 change: the TutorialKit lesson page, “Three reviews to make one boolean honest”', at('S3', PATHS.lesson), [1, 74], 'title: Three reviews to make one boolean honest'),
    code('s3.pr-claim', 's3', 'related', 'PR #120 summary, item 3', cap('pr120'), [7, 7], 'No tutorial/report hookup existed.'),
  ],
};

const review2Reassessed: EvaluationSpec = {
  id: 'review-2.reassessed.findings-2-3', frame: 'r2', code: 'review-2.reassessed.findings-2-3', severity: 'info',
  message: 'The byte-validation and generic-crash findings are fixed.',
  subject: { role: 'axiom', source: at('S2', PATHS.reconcile), line: 47, detail: 'the generic-crash check added at S2' },
  related: [{ role: 'axiom', source: at('S2', PATHS.reconcile), line: 60, detail: 'the byte checks added at S2' }],
  verdicts: approved, provenance: recorded('review2'),
  evidence: [
    prose('review-text', 'r2', 'subject', 'Review 2, recommendation (recorded review text)', cap('review2'), [3, 3], 'The byte-validation and generic-crash findings are fixed.'),
    prose('verification', 'r2', 'related', 'Review 2, verification (recorded review text)', cap('review2'), [13, 13], 'Generic crash, empty canary bytes, corrupted PNG pixels, and zeroed independent read count fail.'),
    gone('mutation-output', 'r2', 'related', 'captured-execution-output', 'Original mutation output', NOT_CAPTURED_MUTATION('Review 2', 'which mutations failed and which passed')),
  ],
};

// ---------------------------------------------------------------------------
// s3: the claimed fix in the first commit of #120 (checker state 3)

const s3Claim: EvaluationSpec = {
  id: 's3.claim', frame: 's3', code: 's3.claimed-fix', severity: 'info',
  message: 'Deleting or forging the retained trace text is now caught; it wasn\'t before.',
  subject: { role: 'fact', source: cap('pr120'), line: 5, detail: 'PR #120 summary, item 1' },
  related: [{ role: 'fact', source: at('S3', PATHS.lesson), line: 45, detail: 'the lesson page’s “Round three” makes the same claim' }],
  verdicts: pending, provenance: recorded('commitS3'),
  evidence: [
    code('pr-claim', 's3', 'subject', 'PR #120 summary, item 1: the claim', cap('pr120'), [5, 5], 'Deleting or forging the retained trace text is now caught'),
    code('lesson-claim', 's3', 'related', 'The lesson page’s “Round three” paragraph', at('S3', PATHS.lesson), [45, 50], 'from the retained trace text itself on every reconciliation'),
    output('diagnostics-report', 's3', 'related', 'Retained detector output (an empty list for every arm)', at('S3', PATHS.diagnosticsReport), [1, 6], '"mat-unblocked": []'),
    output('junit-report', 's3', 'related', 'Retained authoritative check result: 29 tests, 0 failures', at('S3', PATHS.junitReport), [2, 2], 'tests="29"'),
    ...monitor('S3', 's3'),
  ],
};

// ---------------------------------------------------------------------------
// r3: review 3 of #120, known only second-hand

const r3Common = { frame: 'r3' as const, severity: 'error' as const, verdicts: flagged, provenance: { kind: 'recorded', captureId: `secondary-account:git-commit-message:${REVISIONS.S4.pinned}` } as InputProvenance };
const r3OriginalMissing = gone('original-text', 'r3', 'subject', 'recorded-review-prose', 'Review 3, original text',
  'The original text of review 3 could not be retrieved: no review or review thread on GitHub PR #120 (only a Netlify bot comment), only a Netlify thread in Linear, and no comment on CIT-303. See captures/review-3-retrieval-check.json. The findings below are second-hand.');
const r3Missing = gone('mutation-output', 'r3', 'related', 'captured-execution-output', 'Original mutation output', NOT_CAPTURED_MUTATION('Review 3', 'a deleted blocked-arm trace; a prose mention, a failed EACCES open and a same-named file elsewhere'));
const r3RetrievalCheck = output('retrieval-check', 'r3', 'related', 'Record of where review 3’s original text was looked for, and not found', cap('review3Check'), [1, 40], '"found": false');

const review3Finding1: EvaluationSpec = {
  ...r3Common, id: 'review-3.finding-1', code: 'review-3.finding-1.second-hand',
  message: 'nothing required valid trace evidence to exist for an arm whose expected open-count was already zero',
  subject: { role: 'axiom', source: at('S3', PATHS.reconcile), line: 105, detail: 'at S3 the trace check only compares open counts, so a blocked arm (expected count zero) accepts an empty trace' },
  related: [],
  evidence: [
    r3OriginalMissing,
    code('source-at-s3', 'r3', 'related', 'The S3 check this finding is about (count comparison only)', at('S3', PATHS.reconcile), [100, 112], 'independent-read-mismatch'),
    r3RetrievalCheck,
    r3Missing,
    // The only record of review 3 is written with the S4 change, so it becomes available there:
    prose('secondary-account', 's4', 'related', 'Second-hand account of review 3: the cc23e89 commit message, written with the S4 change', cap('commitS4'), [25, 30], 'Review of PR #120 found the independent-read check still only did a'),
    code('s4.checker', 's4', 'related', 'S4 change: every arm’s trace must show a successful open of its own source file', at('S4', PATHS.reconcile), [134, 147], 'trace-missing-source-evidence'),
    ...fact('S4', 's4.control-deleted-blocked-trace', 's4', 'negative control, deleting the blocked arm’s entire retained trace', [144, 147], 28, 'negative control: deleting the blocked arm'),
  ],
};

const review3Finding2: EvaluationSpec = {
  ...r3Common, id: 'review-3.finding-2', code: 'review-3.finding-2.second-hand',
  message: 'the independent-read check still only did a bare substring match on the retained trace text',
  subject: { role: 'axiom', source: at('S3', PATHS.reconcile), line: 30, detail: 'traceOpenCount at S3 counts any line containing dummy-canary.txt' },
  related: [],
  evidence: [
    r3OriginalMissing,
    code('source-at-s3', 'r3', 'related', 'The S3 substring match this finding is about (traceOpenCount)', at('S3', PATHS.reconcile), [24, 31], 'line.contains("dummy-canary.txt")'),
    r3RetrievalCheck,
    r3Missing,
    prose('secondary-account', 's4', 'related', 'Second-hand account of review 3: the cc23e89 commit message, written with the S4 change', cap('commitS4'), [25, 30], 'Review of PR #120 found the independent-read check still only did a'),
    prose('secondary-account-writeup', 's4', 'related', 'Second-hand account in the write-up: “Strengthened per the CIT-303 PR follow-up review”', at('S4', PATHS.writeUp), [311, 349], 'Strengthened per the CIT-303 PR follow-up review'),
    code('s4.checker-parse', 's4', 'related', 'S4 change: a successful openat of the exact quoted path is parsed, not substring-matched', at('S4', PATHS.reconcile), [24, 43], 'local function successfulOpenatCount'),
    code('s4.collector', 's4', 'related', 'S4 change: run_arms.sh collects trace text under the same criterion', at('S4', PATHS.runArms), [41, 60], 'local success_regex'),
    ...fact('S4', 's4.control-prose-mention', 's4', 'negative control, a prose mention of the filename', [148, 152], 29, 'negative control: a prose mention'),
    ...fact('S4', 's4.control-failed-open', 's4', 'negative control, a failed EACCES open', [153, 157], 30, 'negative control: a *failed* openat'),
    ...fact('S4', 's4.control-other-directory', 's4', 'negative control, a same-named file in another directory', [158, 162], 31, 'negative control: a successful openat of a same-named file'),
  ],
};

// ---------------------------------------------------------------------------
// s4: the claimed follow-up (checker state 4), and the merge

const s4Claim: EvaluationSpec = {
  id: 's4.claim', frame: 's4', code: 's4.claimed-fix', severity: 'info',
  message: 'Reconcile.pkl now requires a parsed, successful openat of the exact path, plus proof-of-capture (a successful open of the arm\'s own source file) for every arm; run_arms.sh collects trace text under the same criterion and no longer merges strace\'s stderr with the script\'s own JSON stdout.',
  subject: { role: 'fact', source: cap('commitS4'), line: 30, detail: 'cc23e89 commit message' },
  related: [],
  verdicts: pending, provenance: recorded('commitS4'),
  evidence: [
    code('commit-claim', 's4', 'subject', 'The cc23e89 commit message: the claim', cap('commitS4'), [30, 34], 'Reconcile.pkl now requires a'),
    code('writeup-counts', 's4', 'related', 'Write-up: 29 facts / 75 asserts / 4 examples', at('S4', PATHS.writeUp), [246, 251], '29 facts / 75 asserts / 4 examples'),
    output('diagnostics-report', 's4', 'related', 'Retained detector output (an empty list for every arm)', at('S4', PATHS.diagnosticsReport), [1, 6], '"mat-unblocked": []'),
    output('junit-report', 's4', 'related', 'Retained authoritative check result: 33 tests, 0 failures', at('S4', PATHS.junitReport), [2, 2], 'tests="33"'),
    ...monitor('S4', 's4'),
  ],
};

const landed: EvaluationSpec = {
  id: 'landed.history', frame: 'landed', code: 'landed.merge-to-main', severity: 'info',
  message: 'Merged to main as bc97c0e (parents be95c86 and cc23e89). No review of the final revision, cc23e89, is recorded.',
  subject: { role: 'fact', source: cap('gitLanding'), line: 2, detail: 'the merge commit and its parents' },
  related: [],
  verdicts: pending, provenance: recorded('commitMerge'),
  evidence: [
    output('git-facts', 'landed', 'subject', 'Git facts derived by the collector: merge parents and which commits are ancestors', cap('gitLanding'), [1, 24], 'mergeCommit'),
    output('merge-commit', 'landed', 'related', 'The merge commit object: its tree and parents', cap('commitMerge'), [1, 3], 'parent cc23e89297855dd07b1ee477ced455ab46a94738'),
    output('s4-commit', 'landed', 'related', 'The S4 commit object: the same tree as the merge commit, so what landed is exactly S4', cap('commitS4'), [1, 1], 'tree 2baedb5250f139a4279c428268b77dd1b19d529c'),
    code('api-facts', 'landed', 'related', 'GitHub and Linear metadata copied from connector responses: PR merge times, issue completion times', cap('apiLanding'), [1, 66], 'githubPullRequests'),
    gone('no-review-of-final-revision', 'landed', 'related', 'recorded-review-prose', 'A review of the final revision',
      'No review of cc23e89 is recorded: GitHub shows no review on #120, Linear shows none, and review 3’s own original text is also unretrievable (captures/review-3-retrieval-check.json). Merged is not reviewed.'),
  ],
};

/** In frame order; evaluations of one frame in the order a reader meets them. */
export const EVALUATION_SPECS: readonly EvaluationSpec[] = [
  s1Claim,
  review1Finding1, review1Finding2, review1Finding3, review1Finding4,
  s2Claim,
  review2Gap1, review2Gap2, review2Gap3, review2Reassessed,
  s3Claim,
  review3Finding1, review3Finding2,
  s4Claim,
  landed,
];

/**
 * How a later evaluation relates to an earlier one. This is the only place the
 * link is stated: `RecordedEvaluation` has no relation field, and `related`
 * cannot carry it for the earlier-to-later direction without leaking the
 * future. `basis` says whether the reviewer's own words make the link
 * (`quoted`) or CIT-306 read it from the text (`inferred`).
 */
export type EvaluationRelation = {
  from: string;
  to: string;
  relation: 'restates' | 'reassesses' | 'follows-up';
  basis: 'quoted' | 'inferred';
  quote: string;
};

export const RELATIONS: readonly EvaluationRelation[] = [
  { from: 'review-2.gap-1', to: 'review-1.finding-1', relation: 'restates', basis: 'quoted', quote: 'does not reproduce the original raw-trace mutations' },
  { from: 'review-2.gap-2', to: 'review-1.finding-1', relation: 'restates', basis: 'inferred', quote: 'Include the runtime configuration (`load_defaults`/`variant_processor`) and source/image identity in the case records' },
  { from: 'review-2.gap-3', to: 'review-1.finding-4', relation: 'restates', basis: 'quoted', quote: 'before declaring all four original findings resolved' },
  { from: 'review-2.reassessed.findings-2-3', to: 'review-1.finding-2', relation: 'reassesses', basis: 'quoted', quote: 'The byte-validation and generic-crash findings are fixed.' },
  { from: 'review-2.reassessed.findings-2-3', to: 'review-1.finding-3', relation: 'reassesses', basis: 'quoted', quote: 'The byte-validation and generic-crash findings are fixed.' },
  { from: 'review-3.finding-1', to: 'review-2.gap-1', relation: 'follows-up', basis: 'inferred', quote: 'nothing required valid trace evidence to exist for an arm whose expected open-count was already zero' },
  { from: 'review-3.finding-2', to: 'review-2.gap-1', relation: 'follows-up', basis: 'quoted', quote: 'the independent-read check still only did a bare substring match on the retained trace text' },
];

export const QUESTION_FRAMES: Readonly<Record<QuestionId, FrameKey>> = Object.fromEntries(
  QUESTION_ORDER.map((id) => [id, REVIEW_HISTORY_QUESTIONS[id].frame]),
) as Record<QuestionId, FrameKey>;

export type { EvidenceSpec };
