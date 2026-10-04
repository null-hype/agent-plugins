import type { ReplayRecording } from '../acpReplayContract';
import { buildEvaluation, buildFrame, evaluationIdOf, evidenceIdOf, evidenceLabel, type EvidenceSpec } from './build';
import { EVALUATION_SPECS, FRAME_SPECS } from './declarations';
import { REVIEW_HISTORY_RECORDING_ID, REVIEW_HISTORY_RUN_ID } from './identity';

/**
 * CIT-306: the recorded CIT-294 review history as a CIT-299 `ReplayRecording`.
 *
 * This is data. It contains no controller, resolver or renderer: stepping is
 * CIT-300, opening bytes is CIT-253, and the shared inspector that shows both
 * in Storybook and TutorialKit is CIT-301. Every field is plain JSON, so both
 * hosts can load the same value (the spec round-trips it through JSON).
 */
export const reviewHistoryRecording: ReplayRecording = {
  recordingId: REVIEW_HISTORY_RECORDING_ID,
  runId: REVIEW_HISTORY_RUN_ID,
  frames: FRAME_SPECS.map((spec, index) => buildFrame(spec, index)),
  evaluations: EVALUATION_SPECS.map(buildEvaluation),
};

/**
 * `EvidenceRef` has no display label, so the words a reader sees for each item
 * live here, keyed by evidence id. They describe the item only; nothing in a
 * label mentions anything that happens later.
 */
export const REVIEW_HISTORY_EVIDENCE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  EVALUATION_SPECS.flatMap((evaluation) => evaluation.evidence.map((spec) => [evidenceIdOf(evaluation.id, spec), evidenceLabel(spec)])),
);

/** Every declared evidence item with its ids, for the specs that check each range against the pinned bytes. */
export const REVIEW_HISTORY_EVIDENCE_SPECS: ReadonlyArray<{ evaluationId: string; evidenceId: string; spec: EvidenceSpec }> =
  EVALUATION_SPECS.flatMap((evaluation) =>
    evaluation.evidence.map((spec) => ({ evaluationId: evaluationIdOf(evaluation.id), evidenceId: evidenceIdOf(evaluation.id, spec), spec })),
  );

export { EVALUATION_SPECS, FRAME_SPECS, QUESTION_FRAMES, RELATIONS, type EvaluationRelation } from './declarations';
export { evaluationIdOf, evidenceIdOf } from './build';
export {
  ARMS, BREAKPOINT_IDS, CAPTURES, FRAME_IDS, FRAME_ORDER, MERGE_COMMIT, PATHS, REVIEW_HISTORY_BUNDLE_PATH,
  REVIEW_HISTORY_RECORDING_ID, REVIEW_HISTORY_RUN_ID, REVISIONS,
  type CheckerState, type FrameKey,
} from './identity';
export { QUESTION_ORDER, REVIEW_HISTORY_QUESTIONS, type Question, type QuestionId } from './questions';
export {
  REVIEW_HISTORY_CAPABILITIES, REVIEW_HISTORY_DEFERRED, REVIEW_HISTORY_MISSING_RECORDS, REVIEW_HISTORY_STEP_STATUS,
  type Capability, type DeferredBehaviour, type EvidenceClass, type Implementation, type MissingRecord, type StepStatus,
} from './status';
