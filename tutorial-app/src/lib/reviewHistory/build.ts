import type { AcpPin, AcpVerdict, AcpVerdictChannel } from '../acpTraceProtocol';
import type { ArtifactRef, EvidenceRef, InputProvenance, RecordedEvaluation, ReplayFrame } from '../acpReplayContract';
import type { EvidenceLocation, GovernanceDiagnostic } from '../governanceDiagnostic';
import {
  BREAKPOINT_IDS,
  CAPTURES,
  FRAME_IDS,
  REVIEW_HISTORY_RECORDING_ID,
  REVIEW_HISTORY_RUN_ID,
  REVISIONS,
  sourcePath,
  type FrameKey,
  type Source,
} from './identity';

/**
 * CIT-306 builders. They turn compact declarations into CIT-299's own types
 * (`ReplayFrame`, `RecordedEvaluation`, `EvidenceRef`, `ArtifactRef`) and add no
 * schema of their own. They read no files: what an `ArtifactRef` points at is
 * looked up by the artifact resolver (CIT-253), not here.
 */

export type Lines = readonly [number, number];

type EvidenceCommon = {
  /** Unique within its evaluation. */
  id: string;
  /** The frame at which this evidence becomes available. Later than the evaluation's own frame for the evidence that answers a finding. */
  at: FrameKey;
  role: EvidenceRef['role'];
  kind: EvidenceRef['contentKind'];
  /** What the item is, in words a reader sees. Carried in a side map: `EvidenceRef` has no label field. */
  label: string;
};

export type CapturedEvidenceSpec = EvidenceCommon & {
  source: Source;
  lines: Lines;
  /** A verbatim snippet that must occur on `lines` of the pinned bytes; the bundle spec checks it, so a range cannot drift. */
  anchor: string;
};
export type MissingEvidenceSpec = EvidenceCommon & {
  /** Why nothing was captured. A missing item is an explicit outcome, never an invented artifact. */
  missing: string;
};
export type EvidenceSpec = CapturedEvidenceSpec | MissingEvidenceSpec;

export const isMissing = (spec: EvidenceSpec): spec is MissingEvidenceSpec => 'missing' in spec;

export type LocationSpec = {
  role: EvidenceLocation['role'];
  source: Source;
  line?: number;
  detail: string;
};

export type EvaluationSpec = {
  /** Local id; the evaluation id is `<runId>:<id>`. */
  id: string;
  frame: FrameKey;
  code: string;
  severity: GovernanceDiagnostic['severity'];
  message: string;
  subject: LocationSpec;
  /**
   * Locations that exist at `frame`. `deriveReplaySnapshot` filters an
   * evaluation's `evidence` by availability but passes `diagnostic` through
   * untouched, so anything that appears only later must live in `evidence`
   * (where the prefix filter hides it), never here.
   */
  related: readonly LocationSpec[];
  verdicts: ReadonlyArray<{ channel: AcpVerdictChannel; value: string }>;
  provenance: InputProvenance;
  evidence: readonly EvidenceSpec[];
};

export type FrameSpec = {
  key: FrameKey;
  actor: ReplayFrame['actor'];
  speaker: string;
  action: string;
  provenance: InputProvenance;
  /** Only where an exact time was recorded. Never synthesized. */
  capturedAt?: string;
  pins: readonly AcpPin[];
  verdict?: AcpVerdict;
};

export const evaluationIdOf = (localId: string) => `${REVIEW_HISTORY_RUN_ID}:${localId}`;
export const evidenceIdOf = (evaluationLocalId: string, spec: EvidenceSpec) => `${evaluationLocalId}/${spec.id}`;

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export function buildLocation(spec: LocationSpec): EvidenceLocation {
  return {
    role: spec.role,
    uri: sourcePath(spec.source),
    detail: spec.detail,
    ...(spec.source.kind === 'file' ? { revision: REVISIONS[spec.source.state].pinned } : {}),
    ...(spec.line === undefined ? {} : { line: spec.line }),
  };
}

export function buildArtifact(evidenceId: string, spec: CapturedEvidenceSpec): ArtifactRef {
  const source = spec.source;
  return {
    artifactId: `artifact:${evidenceId}`,
    recordingId: REVIEW_HISTORY_RECORDING_ID,
    runId: REVIEW_HISTORY_RUN_ID,
    // `frameId` of an artifact is its availability frame, as the contract validates.
    frameId: FRAME_IDS[spec.at],
    path: sourcePath(source),
    identity: source.kind === 'file'
      ? { kind: 'revision', revision: REVISIONS[source.state].pinned }
      : { kind: 'capture', captureId: CAPTURES[source.key].captureId },
    location: { kind: 'source-range', startLine: spec.lines[0], endLine: spec.lines[1] },
  };
}

export function buildEvidence(evaluationLocalId: string, spec: EvidenceSpec): EvidenceRef {
  const evidenceId = evidenceIdOf(evaluationLocalId, spec);
  const base = { evidenceId, availableAt: FRAME_IDS[spec.at], role: spec.role, contentKind: spec.kind };
  return isMissing(spec)
    ? { ...base, availability: { status: 'missing', reason: spec.missing } }
    : { ...base, availability: { status: 'captured', artifact: buildArtifact(evidenceId, spec) } };
}

export function evidenceLabel(spec: EvidenceSpec): string {
  if (isMissing(spec)) return `${spec.label} — not captured`;
  const [from, to] = spec.lines;
  const range = from === to ? `line ${from}` : `lines ${from}–${to}`;
  const source = spec.source;
  const where = source.kind === 'file'
    ? `${basename(source.path)} @ ${source.state} ${REVISIONS[source.state].pinned.slice(0, 8)}`
    : `${basename(sourcePath(source))} (capture ${CAPTURES[source.key].captureId})`;
  return `${spec.label} — ${where}, ${range}`;
}

export function buildEvaluation(spec: EvaluationSpec): RecordedEvaluation {
  const evaluationId = evaluationIdOf(spec.id);
  return {
    evaluationId,
    frameId: FRAME_IDS[spec.frame],
    diagnostic: {
      code: spec.code,
      severity: spec.severity,
      message: spec.message,
      subject: buildLocation(spec.subject),
      related: spec.related.map(buildLocation),
      evaluationId,
    },
    evidence: spec.evidence.map((item) => buildEvidence(spec.id, item)),
    verdicts: spec.verdicts.map((verdict) => ({ ...verdict })),
    provenance: spec.provenance,
  };
}

/**
 * Requests (questions, reviews) carry `_meta` in `params` and responses
 * (claimed results, corrections, the merge) in `result`, ACP's own placement.
 * There is deliberately no `method`: these are recorded checkpoints, and a
 * made-up `session/prompt` would present them as a wire exchange.
 */
export function buildFrame(spec: FrameSpec, order: number): ReplayFrame {
  const meta = { pins: spec.pins.map((pin) => ({ ...pin })), ...(spec.verdict ? { verdict: { ...spec.verdict } } : {}) };
  return {
    frameId: FRAME_IDS[spec.key],
    order,
    breakpointIds: [BREAKPOINT_IDS[spec.key]],
    actor: spec.actor,
    speaker: spec.speaker,
    action: spec.action,
    envelope: spec.actor === 'client' ? { jsonrpc: '2.0', params: { _meta: meta } } : { jsonrpc: '2.0', result: { _meta: meta } },
    provenance: {
      recordingId: REVIEW_HISTORY_RECORDING_ID,
      ...(spec.capturedAt ? { capturedAt: spec.capturedAt } : {}),
      ...spec.provenance,
    },
  };
}
