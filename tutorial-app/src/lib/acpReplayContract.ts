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
export type ReplayFrame = AcpFrame & {
  frameId: FrameId;
  order: number;
  breakpointIds?: readonly BreakpointId[];
  provenance: AcpFrame['provenance'] & InputProvenance;
};

export type ArtifactLocation =
  | { kind: 'source-range'; startLine: number; startColumn?: number; endLine: number; endColumn?: number }
  | { kind: 'record'; record: number; field?: string };

/**
 * Enough information for an evidence worker to resolve bytes without consulting
 * playback state. Exactly one immutable world identity is supplied.
 */
export type ArtifactRef = {
  artifactId: ArtifactId;
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
  artifact: ArtifactRef;
};

export type RecordedEvaluation = {
  evaluationId: EvaluationId;
  frameId: FrameId;
  diagnostic: GovernanceDiagnostic;
  evidence: readonly EvidenceRef[];
  /** Independent claims must not be collapsed into a single pass/fail badge. */
  verdicts: ReadonlyArray<{ channel: AcpVerdictChannel; value: string }>;
  provenance: InputProvenance;
};

export type ReplayRecording = {
  recordingId: RecordingId;
  runId: RunId;
  frames: readonly ReplayFrame[];
  evaluations: readonly RecordedEvaluation[];
};

export type ReplayCursor =
  | { kind: 'before-first' }
  | { kind: 'frame'; frameId: FrameId };

export type ReplaySelection =
  | { kind: 'frame'; frameId: FrameId }
  | { kind: 'evaluation'; evaluationId: EvaluationId }
  | { kind: 'evidence'; evidenceId: string }
  | null;

/** Scroll/filter state belongs to the log, not to playback or selection. */
export type LogViewport = { anchorFrameId?: FrameId; filter?: string };

export type ReplayLocation = {
  recordingId: RecordingId;
  runId: RunId;
  cursor: ReplayCursor;
  selection: ReplaySelection;
  viewport: LogViewport;
};

export type ExplicitFailure =
  | { status: 'recording-not-found'; recordingId: RecordingId; runId: RunId }
  | { status: 'frame-not-found'; frameId: FrameId }
  | { status: 'selection-not-in-prefix'; selection: Exclude<ReplaySelection, null> }
  | { status: 'artifact-not-found'; artifact: ArtifactRef }
  | { status: 'artifact-identity-mismatch'; artifact: ArtifactRef; actualIdentity: string };

export type ArtifactResolution =
  | { status: 'resolved'; artifact: ArtifactRef; bytes: Uint8Array }
  | Extract<ExplicitFailure, { status: 'artifact-not-found' | 'artifact-identity-mismatch' }>;

/** CIT-253 implements this independently; it must not seek or mutate playback. */
export interface SuppliedArtifactResolver {
  resolve(ref: ArtifactRef): Promise<ArtifactResolution>;
}

export type ReplaySnapshot = {
  location: ReplayLocation;
  frames: readonly ReplayFrame[];
  evaluations: readonly RecordedEvaluation[];
  availableEvidence: readonly EvidenceRef[];
  selection: ReplaySelection;
  selectionFailure?: Extract<ExplicitFailure, { status: 'selection-not-in-prefix' }>;
};

/** Canonical prefix derivation used by playback and evidence consumers. */
export function deriveReplaySnapshot(recording: ReplayRecording, location: ReplayLocation): ReplaySnapshot | ExplicitFailure {
  if (recording.recordingId !== location.recordingId || recording.runId !== location.runId) {
    return { status: 'recording-not-found', recordingId: location.recordingId, runId: location.runId };
  }

  let end = -1;
  const cursor = location.cursor;
  if (cursor.kind === 'frame') {
    end = recording.frames.findIndex((frame) => frame.frameId === cursor.frameId);
    if (end < 0) return { status: 'frame-not-found', frameId: cursor.frameId };
  }

  const frames = recording.frames.slice(0, end + 1);
  const frameIds = new Set(frames.map((frame) => frame.frameId));
  const evaluations = recording.evaluations.filter((evaluation) => frameIds.has(evaluation.frameId));
  const availableEvidence = evaluations.flatMap((evaluation) => evaluation.evidence)
    .filter((evidence) => frameIds.has(evidence.availableAt));
  const availableEvaluationIds = new Set(evaluations.map((evaluation) => evaluation.evaluationId));
  const availableEvidenceIds = new Set(availableEvidence.map((evidence) => evidence.evidenceId));
  const selected = location.selection;
  const selectionAvailable = selected === null
    || (selected.kind === 'frame' && frameIds.has(selected.frameId))
    || (selected.kind === 'evaluation' && availableEvaluationIds.has(selected.evaluationId))
    || (selected.kind === 'evidence' && availableEvidenceIds.has(selected.evidenceId));

  return {
    location,
    frames,
    evaluations,
    availableEvidence,
    selection: selectionAvailable ? selected : null,
    ...(selected && !selectionAvailable
      ? { selectionFailure: { status: 'selection-not-in-prefix' as const, selection: selected } }
      : {}),
  };
}
