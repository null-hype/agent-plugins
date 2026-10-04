import type { AcpFrame, AcpVerdictChannel } from './acpTraceProtocol';
import type { GovernanceDiagnostic } from './governanceDiagnostic';

/** Opaque, recording-assigned identities. Array indexes and display labels are not identities. */
export type RecordingId = string;
export type RunId = string;
export type FrameId = string;
export type BreakpointId = string;
export type EvaluationId = string;
export type ArtifactId = string;

export type InputProvenance =
  | { kind: 'recorded'; captureId: string }
  | { kind: 'scripted'; scriptId: string; disclosure: string }
  | { kind: 'simulated'; simulatorId: string; disclosure: string };

/** Logical order is mandatory. Wall-clock time is optional and is never synthesized. */
export type ReplayFrame = Omit<AcpFrame, 'provenance'> & {
  frameId: FrameId;
  order: number;
  breakpointIds?: readonly BreakpointId[];
  provenance: Omit<AcpFrame['provenance'], 'capturedAt'> & { capturedAt?: string } & InputProvenance;
};

export type ArtifactLocation =
  | { kind: 'source-range'; startLine: number; startColumn?: number; endLine: number; endColumn?: number }
  | { kind: 'record'; record: number; field?: string };

/** An immutable artifact address. Resolution must never fall back to the current workspace. */
export type ArtifactRef = {
  artifactId: ArtifactId;
  recordingId: RecordingId;
  runId: RunId;
  frameId: FrameId;
  path: string;
  identity:
    | { kind: 'revision'; revision: string }
    | { kind: 'snapshot'; snapshotId: string }
    | { kind: 'capture'; captureId: string };
  location: ArtifactLocation;
};

export type EvidenceRef = {
  evidenceId: string;
  availableAt: FrameId;
  role: 'subject' | 'related';
  contentKind: 'source' | 'captured-execution-output' | 'recorded-review-prose';
  /** `missing` records that no output was captured; it is not an invented execution. */
  availability: { status: 'captured'; artifact: ArtifactRef } | { status: 'missing'; reason: string };
};

export type RecordedEvaluation = {
  /** Unique in a run, even when the source trace reuses its diagnostic evaluationId. */
  evaluationId: EvaluationId;
  /** The untouched identity found in captured bytes, retained for audit/adaptation. */
  sourceEvaluationId?: string;
  frameId: FrameId;
  diagnostic: GovernanceDiagnostic;
  evidence: readonly EvidenceRef[];
  verdicts: ReadonlyArray<{ channel: AcpVerdictChannel; value: string }>;
  provenance: InputProvenance;
};

export type ReplayRecording = {
  recordingId: RecordingId;
  runId: RunId;
  frames: readonly ReplayFrame[];
  evaluations: readonly RecordedEvaluation[];
};

export type ReplayCursor = { kind: 'before-first' } | { kind: 'frame'; frameId: FrameId };
export type ReplaySelection =
  | { kind: 'frame'; frameId: FrameId }
  | { kind: 'question'; frameId: FrameId }
  | { kind: 'evaluation'; evaluationId: EvaluationId }
  | { kind: 'evidence'; evidenceId: string }
  | null;

/** Scroll/filter state belongs to the log, not to playback or selection. */
export type LogViewport = { anchorFrameId?: FrameId; filter?: string };
export type ReplayLocation = { recordingId: RecordingId; runId: RunId; cursor: ReplayCursor; selection: ReplaySelection; viewport: LogViewport };

export type ExplicitFailure =
  | { status: 'recording-not-found'; recordingId: RecordingId; runId: RunId }
  | { status: 'invalid-recording'; reason: string }
  | { status: 'frame-not-found'; frameId: FrameId }
  | { status: 'selection-not-in-prefix'; selection: Exclude<ReplaySelection, null> }
  | { status: 'artifact-not-found'; artifact: ArtifactRef }
  | { status: 'artifact-identity-mismatch'; artifact: ArtifactRef; actualIdentity: string }
  | { status: 'artifact-location-mismatch'; artifact: ArtifactRef; reason: string };

export type ArtifactResolution =
  | { status: 'resolved'; artifact: ArtifactRef; bytes: Uint8Array }
  | Extract<ExplicitFailure, { status: 'artifact-not-found' | 'artifact-identity-mismatch' | 'artifact-location-mismatch' }>;

/** CIT-253 implements this independently; it must not seek or mutate playback. */
export interface SuppliedArtifactResolver { resolve(ref: ArtifactRef): Promise<ArtifactResolution>; }

export type ReplaySnapshot = {
  location: ReplayLocation;
  frames: readonly ReplayFrame[];
  evaluations: readonly RecordedEvaluation[];
  availableEvidence: readonly EvidenceRef[];
  selection: ReplaySelection;
  selectionFailure?: Extract<ExplicitFailure, { status: 'selection-not-in-prefix' }>;
};

/**
 * Validate once at ingestion. Array order is canonical and `order` must equal
 * its zero-based position, so cursor lookup, prefix slicing and navigation share
 * exactly one ordering. Timestamps have no ordering role.
 */
export function validateReplayRecording(recording: ReplayRecording): Extract<ExplicitFailure, { status: 'invalid-recording' }> | null {
  const frameIds = new Set<string>();
  for (const [index, frame] of recording.frames.entries()) {
    if (frame.order !== index) return { status: 'invalid-recording', reason: `frame ${frame.frameId} order ${frame.order} does not match array position ${index}` };
    if (frameIds.has(frame.frameId)) return { status: 'invalid-recording', reason: `duplicate frameId ${frame.frameId}` };
    frameIds.add(frame.frameId);
    if (frame.provenance.recordingId !== recording.recordingId) return { status: 'invalid-recording', reason: `frame ${frame.frameId} belongs to recording ${frame.provenance.recordingId}` };
  }
  const evaluationIds = new Set<string>();
  const evidenceIds = new Set<string>();
  for (const evaluation of recording.evaluations) {
    if (evaluationIds.has(evaluation.evaluationId)) return { status: 'invalid-recording', reason: `duplicate evaluationId ${evaluation.evaluationId}` };
    evaluationIds.add(evaluation.evaluationId);
    if (!frameIds.has(evaluation.frameId)) return { status: 'invalid-recording', reason: `evaluation ${evaluation.evaluationId} has unknown frame ${evaluation.frameId}` };
    for (const evidence of evaluation.evidence) {
      if (evidenceIds.has(evidence.evidenceId)) return { status: 'invalid-recording', reason: `duplicate evidenceId ${evidence.evidenceId}` };
      evidenceIds.add(evidence.evidenceId);
      if (!frameIds.has(evidence.availableAt)) return { status: 'invalid-recording', reason: `evidence ${evidence.evidenceId} has unknown availability frame ${evidence.availableAt}` };
      if (evidence.availability.status === 'captured') {
        const ref = evidence.availability.artifact;
        if (ref.recordingId !== recording.recordingId || ref.runId !== recording.runId || ref.frameId !== evidence.availableAt) {
          return { status: 'invalid-recording', reason: `artifact ${ref.artifactId} location does not belong to its recording, run, and availability frame` };
        }
      }
    }
  }
  return null;
}

/** Canonical prefix derivation used by playback and evidence consumers. */
export function deriveReplaySnapshot(recording: ReplayRecording, location: ReplayLocation): ReplaySnapshot | ExplicitFailure {
  if (recording.recordingId !== location.recordingId || recording.runId !== location.runId) return { status: 'recording-not-found', recordingId: location.recordingId, runId: location.runId };
  const invalid = validateReplayRecording(recording);
  if (invalid) return invalid;

  let end = -1;
  if (location.cursor.kind === 'frame') {
    const cursorFrameId = location.cursor.frameId;
    end = recording.frames.findIndex((frame) => frame.frameId === cursorFrameId);
    if (end < 0) return { status: 'frame-not-found', frameId: cursorFrameId };
  }
  const frames = recording.frames.slice(0, end + 1);
  const frameIds = new Set(frames.map(({ frameId }) => frameId));
  // Return a prefix-safe copy rather than exposing future evidence through an
  // otherwise available evaluation. Keep the supplied recording immutable.
  const evaluations = recording.evaluations
    .filter(({ frameId }) => frameIds.has(frameId))
    .map((evaluation) => ({
      ...evaluation,
      evidence: evaluation.evidence.filter(({ availableAt }) => frameIds.has(availableAt)),
    }));
  const availableEvidence = evaluations.flatMap(({ evidence }) => evidence);
  const evaluationIds = new Set(evaluations.map(({ evaluationId }) => evaluationId));
  const evidenceIds = new Set(availableEvidence.map(({ evidenceId }) => evidenceId));
  const selected = location.selection;
  const selectionAvailable = selected === null
    || ((selected.kind === 'frame' || selected.kind === 'question') && frameIds.has(selected.frameId))
    || (selected.kind === 'evaluation' && evaluationIds.has(selected.evaluationId))
    || (selected.kind === 'evidence' && evidenceIds.has(selected.evidenceId));
  const effectiveSelection = selectionAvailable ? selected : null;
  return {
    // This is the canonical reopenable location. A rejected requested
    // selection remains available only in selectionFailure for diagnostics.
    location: { ...location, selection: effectiveSelection },
    frames, evaluations, availableEvidence, selection: effectiveSelection,
    ...(selected && !selectionAvailable ? { selectionFailure: { status: 'selection-not-in-prefix' as const, selection: selected } } : {}),
  };
}
