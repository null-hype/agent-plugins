import { describe, expect, it } from 'vitest';
import { deriveReplaySnapshot, type ReplayLocation, type ReplayRecording } from './acpReplayContract';
import type { GovernanceDiagnostic } from './governanceDiagnostic';

const diagnostic: GovernanceDiagnostic = {
  code: 'fm-missing-delivery', severity: 'error', message: 'missing',
  subject: { role: 'fact', uri: 'fixtures/arrivals/4231.json', detail: 'arrival [4,2,3,1]' },
  related: [], evaluationId: 'followerMaze.orderedRouting:arrival-4231:arrival-order',
};
const provenance = { recordingId: 'ghost-trace-v1', capturedAt: '2026-09-22T08:35:12.572Z', kind: 'recorded' as const, captureId: 'ghost-trace-v1' };
const frame = (frameId: string, order: number) => ({
  frameId, order, actor: order % 2 ? 'agent' as const : 'client' as const, action: frameId,
  envelope: { jsonrpc: '2.0' as const }, provenance,
});
const recording: ReplayRecording = {
  recordingId: 'ghost-trace-v1', runId: 'arrival-4231',
  frames: [frame('request', 0), frame('failure', 1), frame('repair-request', 2), frame('repair-pass', 3)],
  evaluations: [{
    evaluationId: diagnostic.evaluationId, frameId: 'failure', diagnostic, verdicts: [], provenance,
    evidence: [{
      evidenceId: 'arrival-order-observation', availableAt: 'failure', role: 'related',
      artifact: { artifactId: 'wire-observation', path: 'evidence/ghost-trace-v1/wire-transcript.jsonl', identity: { kind: 'capture', captureId: 'ghost-trace-v1' }, location: { kind: 'record', record: 6, field: 'result._meta.diagnostic.related[1]' } },
    }],
  }],
};
const at = (frameId: string, selection: ReplayLocation['selection'] = null): ReplayLocation => ({
  recordingId: recording.recordingId, runId: recording.runId, cursor: { kind: 'frame', frameId }, selection, viewport: { anchorFrameId: 'request' },
});

describe('ACP replay contract', () => {
  it('derives inherited state from the recorded prefix and excludes future state', () => {
    const snapshot = deriveReplaySnapshot(recording, at('failure'));
    expect(snapshot).toMatchObject({ frames: [{ frameId: 'request' }, { frameId: 'failure' }], evaluations: [{ frameId: 'failure' }] });
    if ('frames' in snapshot) expect(snapshot.frames.map(({ frameId }) => frameId)).not.toContain('repair-pass');
  });

  it('intentionally removes later evidence and selection when stepping back', () => {
    const snapshot = deriveReplaySnapshot(recording, at('request', { kind: 'evidence', evidenceId: 'arrival-order-observation' }));
    expect(snapshot).toMatchObject({ availableEvidence: [], selection: null, selectionFailure: { status: 'selection-not-in-prefix' } });
  });

  it('reproduces the identical prefix after forward replay', () => {
    expect(deriveReplaySnapshot(recording, at('failure'))).toEqual(deriveReplaySnapshot(recording, at('failure')));
  });

  it('rejects an invalid deep link instead of substituting another frame', () => {
    expect(deriveReplaySnapshot(recording, at('not-a-frame'))).toEqual({ status: 'frame-not-found', frameId: 'not-a-frame' });
  });
});
