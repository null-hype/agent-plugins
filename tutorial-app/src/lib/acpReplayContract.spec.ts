import { describe, expect, it } from 'vitest';
import { deriveReplaySnapshot, validateReplayRecording, type ReplayLocation, type ReplayRecording } from './acpReplayContract';
import type { GovernanceDiagnostic } from './governanceDiagnostic';

const diagnostic = (evaluationId: string, code = 'fm-missing-delivery'): GovernanceDiagnostic => ({
  code, severity: code === 'PASS' ? 'info' : 'error', message: code,
  subject: { role: 'fact', uri: 'fixtures/arrivals/4231.json', detail: 'arrival [4,2,3,1]' }, related: [], evaluationId,
});
const provenance = { recordingId: 'ghost-trace-v1', kind: 'recorded' as const, captureId: 'ghost-trace-v1' };
const frame = (frameId: string, order: number) => ({
  frameId, order, actor: order % 2 ? 'agent' as const : 'client' as const, action: frameId,
  envelope: { jsonrpc: '2.0' as const }, provenance,
});
const artifact = (frameId: string, revision = 'be95c86') => ({
  artifactId: `observation-${frameId}`, recordingId: 'ghost-trace-v1', runId: 'arrival-4231', frameId,
  path: 'evidence/ghost-trace-v1/wire-transcript.jsonl', identity: { kind: 'revision' as const, revision },
  location: { kind: 'record' as const, record: frameId === 'failure' ? 6 : 8, field: 'result._meta.diagnostic' },
});
const recording: ReplayRecording = {
  recordingId: 'ghost-trace-v1', runId: 'arrival-4231',
  frames: [frame('request', 0), frame('failure', 1), frame('repair-request', 2), frame('repair-pass', 3)],
  evaluations: [
    {
      evaluationId: 'followerMaze.orderedRouting:arrival-4231:arrival-order',
      sourceEvaluationId: 'followerMaze.orderedRouting:arrival-4231', frameId: 'failure',
      diagnostic: diagnostic('followerMaze.orderedRouting:arrival-4231'), verdicts: [], provenance,
      evidence: [{ evidenceId: 'arrival-order-observation', availableAt: 'failure', role: 'related', contentKind: 'captured-execution-output', availability: { status: 'captured', artifact: artifact('failure') } }],
    },
    {
      evaluationId: 'followerMaze.orderedRouting:arrival-4231:reorder-buffer',
      sourceEvaluationId: 'followerMaze.orderedRouting:arrival-4231', frameId: 'repair-pass',
      diagnostic: diagnostic('followerMaze.orderedRouting:arrival-4231', 'PASS'), verdicts: [], provenance,
      evidence: [{ evidenceId: 'repair-observation', availableAt: 'repair-pass', role: 'related', contentKind: 'captured-execution-output', availability: { status: 'captured', artifact: artifact('repair-pass', 'repaired-revision') } }],
    },
  ],
};
const at = (frameId: string, selection: ReplayLocation['selection'] = null, viewport: ReplayLocation['viewport'] = { anchorFrameId: 'request' }): ReplayLocation => ({
  recordingId: recording.recordingId, runId: recording.runId, cursor: { kind: 'frame', frameId }, selection, viewport,
});

describe('ACP replay contract', () => {
  it('accepts logical order without wall-clock timestamps and rejects ambiguous order', () => {
    expect(validateReplayRecording(recording)).toBeNull();
    expect(recording.frames.every(({ provenance }) => provenance.capturedAt === undefined)).toBe(true);
    const outOfOrder = { ...recording, frames: [recording.frames[0], { ...recording.frames[1], order: 7 }] };
    expect(validateReplayRecording(outOfOrder)).toMatchObject({ status: 'invalid-recording', reason: expect.stringContaining('array position 1') });
  });

  it('retains inherited state, excludes future evidence, and preserves same-path revision identity', () => {
    const failure = deriveReplaySnapshot(recording, at('failure'));
    expect(failure).toMatchObject({ frames: [{ frameId: 'request' }, { frameId: 'failure' }], evaluations: [{ frameId: 'failure' }], availableEvidence: [{ evidenceId: 'arrival-order-observation' }] });
    if ('evaluations' in failure) {
      expect(failure.evaluations.map(({ evaluationId }) => evaluationId)).not.toContain('followerMaze.orderedRouting:arrival-4231:reorder-buffer');
      expect(failure.availableEvidence[0].availability).toMatchObject({ artifact: { identity: { revision: 'be95c86' } } });
    }
    const repaired = deriveReplaySnapshot(recording, at('repair-pass'));
    if ('availableEvidence' in repaired) expect(repaired.availableEvidence[1].availability).toMatchObject({ artifact: { identity: { revision: 'repaired-revision' } } });
  });

  it('hides delayed evidence through every snapshot path until its availability frame', () => {
    const delayed: ReplayRecording = structuredClone(recording);
    delayed.evaluations[0].evidence[0].availableAt = 'repair-request';
    const captured = delayed.evaluations[0].evidence[0].availability;
    if (captured.status === 'captured') captured.artifact.frameId = 'repair-request';

    const beforeAvailability = deriveReplaySnapshot(delayed, at('failure'));
    expect(beforeAvailability).toMatchObject({ evaluations: [{ evidence: [] }], availableEvidence: [] });
    expect(delayed.evaluations[0].evidence).toHaveLength(1);

    const atAvailability = deriveReplaySnapshot(delayed, at('repair-request'));
    expect(atAvailability).toMatchObject({
      evaluations: [{ evidence: [{ evidenceId: 'arrival-order-observation' }] }],
      availableEvidence: [{ evidenceId: 'arrival-order-observation' }],
    });
  });

  it('keeps cursor, question selection, and viewport independent and clears only excluded selections', () => {
    const viewport = { anchorFrameId: 'request', filter: 'delivery' };
    expect(deriveReplaySnapshot(recording, at('failure', { kind: 'question', frameId: 'request' }, viewport))).toMatchObject({
      location: { cursor: { frameId: 'failure' }, viewport }, selection: { kind: 'question', frameId: 'request' },
    });
    const rewound = deriveReplaySnapshot(recording, at('request', { kind: 'evidence', evidenceId: 'arrival-order-observation' }, viewport));
    expect(rewound).toMatchObject({
      location: { cursor: { frameId: 'request' }, selection: null, viewport }, availableEvidence: [], selection: null,
      selectionFailure: { status: 'selection-not-in-prefix' },
    });
    if ('location' in rewound) {
      const reopened = deriveReplaySnapshot(recording, structuredClone(rewound.location));
      expect(reopened).toMatchObject({ location: { selection: null }, selection: null });
      expect(reopened).not.toHaveProperty('selectionFailure');
    }
  });

  it('makes direct seek and step back/forward derive the identical historical state', () => {
    const direct = deriveReplaySnapshot(recording, at('failure', { kind: 'evaluation', evaluationId: recording.evaluations[0].evaluationId }));
    deriveReplaySnapshot(recording, at('request'));
    const stepped = deriveReplaySnapshot(recording, at('failure', { kind: 'evaluation', evaluationId: recording.evaluations[0].evaluationId }));
    expect(stepped).toEqual(direct);
  });

  it('rejects invalid frames, wrong recordings, locations, and duplicate evaluation identities', () => {
    expect(deriveReplaySnapshot(recording, at('not-a-frame'))).toEqual({ status: 'frame-not-found', frameId: 'not-a-frame' });
    expect(deriveReplaySnapshot(recording, { ...at('request'), recordingId: 'other' })).toMatchObject({ status: 'recording-not-found' });
    const wrongLocation = structuredClone(recording) as ReplayRecording;
    const captured = wrongLocation.evaluations[0].evidence[0].availability;
    if (captured.status === 'captured') captured.artifact.recordingId = 'other';
    expect(validateReplayRecording(wrongLocation)).toMatchObject({ status: 'invalid-recording', reason: expect.stringContaining('does not belong') });
    const duplicate = { ...recording, evaluations: [...recording.evaluations, { ...recording.evaluations[1], evaluationId: recording.evaluations[0].evaluationId }] };
    expect(validateReplayRecording(duplicate)).toMatchObject({ status: 'invalid-recording', reason: expect.stringContaining('duplicate evaluationId') });
  });

  it('represents absent mutation output without manufacturing an artifact', () => {
    const missing: ReplayRecording = { ...recording, evaluations: [{ ...recording.evaluations[0], evidence: [{ ...recording.evaluations[0].evidence[0], availability: { status: 'missing', reason: 'mutation was not executed in this capture' } }] }] };
    expect(validateReplayRecording(missing)).toBeNull();
    expect(deriveReplaySnapshot(missing, at('failure'))).toMatchObject({ availableEvidence: [{ availability: { status: 'missing' } }] });
  });
});
