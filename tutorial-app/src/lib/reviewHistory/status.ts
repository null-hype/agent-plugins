import type { FrameKey } from './identity';

/**
 * CIT-306: the two label axes the walkthrough must keep apart, in CIT-305's
 * vocabulary (section 3). A step can be `working` and still show `recorded
 * prose`; implementation status says whether the interaction runs today,
 * evidence class says what kind of material it shows.
 */
export type Implementation = 'working' | 'stubbed' | 'missing';
export type EvidenceClass = 'captured execution' | 'live computation' | 'recorded prose' | 'authored illustration' | 'not available';

export type StepStatus = {
  /** The CIT-305 transition-table row this frame carries. */
  row: string;
  implementation: Implementation;
  evidence: readonly EvidenceClass[];
  /** The only record of the step's content is a second-hand account. */
  secondHand?: true;
  note: string;
};

export type Capability = {
  id: string;
  what: string;
  status: Implementation;
  owner: string;
  /** Needed before the walkthrough counts as complete. */
  required: boolean;
  basis: string;
};

/**
 * What exists today, and who owns what does not. A missing shared capability is
 * reported against its owning issue; it is not a reason to add a second
 * controller, resolver or renderer here.
 */
export const REVIEW_HISTORY_CAPABILITIES: readonly Capability[] = [
  { id: 'recording-derivation', what: 'The recording validates and derives the exact prefix state at every cursor, with selection and viewport independent of it', status: 'working', owner: 'CIT-299 (contract) · CIT-306 (data)', required: true, basis: 'deriveReplaySnapshot over reviewHistoryRecording; sequence.spec.ts' },
  { id: 'pinned-evidence-bundle', what: 'Exact bytes at the pinned revisions and captures, verified by git blob id, sha256 and commit-object hash', status: 'working', owner: 'CIT-306', required: true, basis: 'evidence/cit-294-review-history-v1; bundle.spec.ts' },
  { id: 'playback-controls', what: 'Step back and forward, seek to a breakpoint, continue to the next recorded diagnostic, reset, as one controller', status: 'missing', owner: 'CIT-300', required: true, basis: 'Not on main. Draft PR #126 (head 1a0dd75, opened while this was being built) proposes one; it is unreviewed and unmerged, so it is not consumed here' },
  { id: 'artifact-resolution', what: 'Open the exact bytes behind an ArtifactRef at its revision or capture, with the source range highlighted and explicit not-found, identity-mismatch and location-mismatch outcomes', status: 'missing', owner: 'CIT-253', required: true, basis: 'Only the SuppliedArtifactResolver interface is on main. Draft PR #125 (head b8979a0) proposes a resolver and inspector; it is unreviewed and unmerged, so it is not consumed here' },
  { id: 'shared-inspector', what: 'One inspector in Storybook and TutorialKit: same state in both, reload-safe link, keyboard use, the input, monitor and diagnostic channels kept apart', status: 'missing', owner: 'CIT-301', required: true, basis: 'Blocked by CIT-300 and CIT-253 and not started. Draft PR #126 adds a development story at the id CIT-299 named, but it is the CIT-300 controller demo over the Follower Maze recording, not the shared inspector' },
  { id: 'revision-compare', what: 'Select a recorded revision and compare it with the next (S1 with S2, S2 with S3, S3 with S4) without moving playback', status: 'missing', owner: 'CIT-301 (host) · CIT-253 (bytes)', required: true, basis: 'The data supports it: the same path is bundled at consecutive revisions and each is available in the prefix at its own frame' },
  { id: 'arm-comparison-ui', what: 'The richer MATLAB arm comparison across the unblocked, blocked and PNG runs', status: 'missing', owner: 'CIT-302', required: false, basis: 'Not a prerequisite for this slice (CIT-306 brief)' },
  { id: 'question-authoring', what: 'Typing a new or post hoc question, grey suggestions, premise and hypothetical-commit exploration', status: 'missing', owner: 'CIT-304', required: false, basis: 'Deliberately deferred; this replay does not complete it' },
  { id: 'prospective-sealing', what: 'Registering a declaration before a run, sealed against later edits', status: 'missing', owner: 'CIT-233', required: false, basis: 'Prospective runs only; a historical run cannot be registered' },
];

/**
 * Per-step labels. Every step is `stubbed` today: the corrected lesson page
 * narrates it, but nothing a reader can select, step or open exists yet. The
 * spec refuses `working` while the shared inspector is missing, so a polished
 * replay cannot quietly overclaim.
 */
export const REVIEW_HISTORY_STEP_STATUS: Readonly<Record<FrameKey, StepStatus>> = {
  q0: { row: 'T1', implementation: 'stubbed', evidence: ['recorded prose'], note: 'Q0 is the issue text as retrieved, not a sealed declaration. Selecting it as a question needs the shared inspector.' },
  s1: { row: 'T2', implementation: 'stubbed', evidence: ['captured execution', 'recorded prose', 'not available'], note: 'One live run of four arms; no authoritative check result was retained at this revision.' },
  r1: { row: 'T3', implementation: 'stubbed', evidence: ['recorded prose', 'not available'], note: 'Four findings in the reviewer’s own words; the mutation output was not retained.' },
  s2: { row: 'T4', implementation: 'stubbed', evidence: ['captured execution', 'recorded prose'], note: 'The claim that all five mutations now fail is shown beside review 2’s reply.' },
  r2: { row: 'T5', implementation: 'stubbed', evidence: ['recorded prose', 'not available'], note: 'Two earlier findings reassessed as fixed, three gaps remain; the mutation output was not retained.' },
  s3: { row: 'T6', implementation: 'stubbed', evidence: ['captured execution', 'recorded prose'], note: 'Includes the lesson page whose “Round three” claim review 3 contradicts.' },
  r3: { row: 'T7', implementation: 'stubbed', evidence: ['recorded prose', 'not available'], secondHand: true, note: 'The original review text could not be retrieved; the findings are second-hand.' },
  s4: { row: 'T8', implementation: 'stubbed', evidence: ['captured execution', 'recorded prose'], note: 'No review of this revision is recorded.' },
  landed: { row: 'T9', implementation: 'stubbed', evidence: ['captured execution'], note: 'Merged is not reviewed.' },
};

export type DeferredBehaviour = { row: string; behaviour: string; owner: string; note: string };

/** Named here so they cannot disappear behind a polished replay. */
export const REVIEW_HISTORY_DEFERRED: readonly DeferredBehaviour[] = [
  { row: 'T12', behaviour: 'Type a new or post hoc question while inspecting old evidence', owner: 'CIT-304', note: 'When built, such a question carries its own id and “asked at” time and is never styled as a prediction recorded before the run.' },
  { row: 'T13', behaviour: 'See a grey premise or follow-up suggestion and accept it', owner: 'CIT-304', note: 'Does not exist anywhere in the repository.' },
  { row: 'T14', behaviour: 'Select a different premise to explore an alternative', owner: 'CIT-304', note: 'The original question and run stay unchanged.' },
  { row: 'T15', behaviour: 'Select a hypothetical commit or branch', owner: 'CIT-304', note: 'A hypothetical state is never shown as a recorded one.' },
  { row: '—', behaviour: 'Register a declaration before the run', owner: 'CIT-233', note: 'Not an action in this slice: a historical run cannot be registered. Q0 carries “not sealed before this run” instead.' },
];

export type MissingRecord = {
  id: string;
  what: string;
  standing: 'never existed' | 'not retrievable' | 'not retained' | 'not recorded';
  note: string;
  /** Evidence ids that show this absence in the recording, where it is shown there. */
  evidenceIds: readonly string[];
};

/** Absence is shown as absence. Each of these is a record the walkthrough does not have and does not invent. */
export const REVIEW_HISTORY_MISSING_RECORDS: readonly MissingRecord[] = [
  { id: 'sealed-declaration', what: 'A sealed declaration or registration made before the run', standing: 'never existed', note: 'Q0 is the issue text as retrieved. No Register action is offered and none is simulated (CIT-304).', evidenceIds: [] },
  { id: 'proton-pass-observation', what: 'A PROTON_PASS_AGENT_REASON, or any Proton Pass observation, for this run', standing: 'never existed', note: 'No such record exists for this history; none is invented.', evidenceIds: [] },
  { id: 'review-3-original-text', what: 'The original text of review 3', standing: 'not retrievable', note: 'Searched on GitHub and Linear; see captures/review-3-retrieval-check.json. A second-hand account is shown, labelled.', evidenceIds: ['review-3.finding-1/original-text', 'review-3.finding-2/original-text'] },
  { id: 'original-mutation-output', what: 'The output of the mutation runs behind reviews 1, 2 and 3', standing: 'not retained', note: 'Made in temporary copies; only the review prose records the results.', evidenceIds: ['review-1.finding-1/mutation-output', 'review-1.finding-2/mutation-output', 'review-1.finding-3/mutation-output', 'review-2.gap-1/mutation-output', 'review-2.gap-2/mutation-output', 'review-2.reassessed.findings-2-3/mutation-output', 'review-3.finding-1/mutation-output', 'review-3.finding-2/mutation-output'] },
  { id: 'check-result-at-s1', what: 'An authoritative check result or detector output retained with #117', standing: 'not retained', note: 'reports/ does not exist at 20aafd26; #118 adds it.', evidenceIds: ['s1.claim/retained-result', 'review-1.finding-4/absent-reports'] },
  { id: 'tutorial-page-at-s2', what: 'A TutorialKit page for this case at #118', standing: 'never existed', note: 'Review 2’s third gap. The page is added by the first commit of #120; the collector records its presence at each state.', evidenceIds: ['review-2.gap-3/absent-tutorial-page'] },
  { id: 'review-of-final-revision', what: 'Any review of cc23e89, the final revision', standing: 'not recorded', note: 'The history ends at a merge with no recorded review of the last change.', evidenceIds: ['landed.history/no-review-of-final-revision'] },
  { id: 'pre-rewrite-s3-s4', what: 'The commits GitHub replaced when it re-created S3 and S4 at merge time', standing: 'not recorded', note: 'Review 3 saw the pre-rewrite S3; only the rewritten 296ca9f and cc23e89 are retrievable.', evidenceIds: [] },
  { id: 'retained-flags-for-mutations', what: 'A retained report of the checker flags that the mutations raise', standing: 'not retained', note: 'diagnostics.json is an empty list for every arm at S2, S3 and S4; the flags the mutations raise are asserted in cit294.test.pkl and listed as passing in the JUnit report, but never retained as a report of their own.', evidenceIds: [] },
];
