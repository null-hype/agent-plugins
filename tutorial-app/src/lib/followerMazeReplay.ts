import { metaOf, type AcpFrame } from './acpTraceProtocol';
import type { ArtifactRef, EvidenceRef, ReplayRecording } from './acpReplayContract';

const recordingId = 'ghost-trace-v1';
const runId = 'arrival-4231';
const revision = 'be95c86ea1fddd8913cab7577f2405c1a2e90205';
const frameIds = ['request', 'failure', 'repair-request', 'repair-pass'] as const;

function artifact(frameId: string, artifactId: string, path: string, location: ArtifactRef['location']): ArtifactRef {
  return {
    artifactId, recordingId, runId, frameId, path, location,
    identity: path.endsWith('.ts')
      ? { kind: 'revision', revision }
      : { kind: 'capture', captureId: recordingId },
  };
}

function evidence(frameId: string, suffix: 'arrival-order' | 'reorder-buffer'): EvidenceRef[] {
  return [
    {
      evidenceId: `${suffix}-rule`, availableAt: frameId, role: 'subject', contentKind: 'source',
      availability: { status: 'captured', artifact: artifact(frameId, 'follower-maze-rule', 'tutorial-app/evidence/ghost-trace-v1/followerMaze.ts', { kind: 'source-range', startLine: 279, endLine: 334 }) },
    },
    {
      evidenceId: `${suffix}-observation`, availableAt: frameId, role: 'related', contentKind: 'captured-execution-output',
      availability: { status: 'captured', artifact: artifact(frameId, `${suffix}-observation`, 'tutorial-app/evidence/ghost-trace-v1/wire-transcript.jsonl', { kind: 'record', record: suffix === 'arrival-order' ? 6 : 8, field: 'result._meta.diagnostic.related[1]' }) },
    },
  ];
}

/** Adapts the existing captured ACP frames to CIT-299's stable replay IDs. */
export function createFollowerMazeReplayRecording(capturedFrames: readonly AcpFrame[]): ReplayRecording {
  if (capturedFrames.length !== frameIds.length) {
    throw new Error(`incomplete Follower Maze recording: expected ${frameIds.length} frames, received ${capturedFrames.length}`);
  }

  const frames = capturedFrames.map((frame, order) => ({
    ...frame,
    frameId: frameIds[order],
    order,
    breakpointIds: order === 0 ? ['before-failure'] : order === 1 ? ['failure-result'] : order === 3 ? ['repair-result'] : undefined,
    provenance: {
      recordingId,
      capturedAt: frame.provenance.capturedAt,
      kind: 'recorded' as const,
      captureId: recordingId,
    },
  }));

  const evaluations = ([['failure', 'arrival-order'], ['repair-pass', 'reorder-buffer']] as const).map(([frameId, suffix]) => {
    const frame = frames.find((candidate) => candidate.frameId === frameId)!;
    const diagnostic = metaOf(frame.envelope)?.diagnostic;
    if (!diagnostic) throw new Error(`captured Follower Maze frame ${frameId} has no diagnostic`);
    return {
      evaluationId: `followerMaze.orderedRouting:${runId}:${suffix}`,
      sourceEvaluationId: diagnostic.evaluationId,
      frameId,
      diagnostic,
      evidence: evidence(frameId, suffix),
      verdicts: metaOf(frame.envelope)?.verdict ? [{ channel: metaOf(frame.envelope)!.verdict!.channel, value: JSON.stringify(metaOf(frame.envelope)!.verdict) }] : [],
      provenance: { kind: 'recorded' as const, captureId: recordingId },
    };
  });

  return { recordingId, runId, frames, evaluations };
}
