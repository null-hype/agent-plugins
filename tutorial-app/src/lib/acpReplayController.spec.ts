import { describe, expect, it } from 'vitest';
import { AcpReplayController } from './acpReplayController';
import type { ReplayRecording, ReplaySnapshot } from './acpReplayContract';

const provenance = { recordingId: 'recording', kind: 'recorded' as const, captureId: 'capture' };
const frames = ['request', 'failure', 'repair-request', 'repair-pass'].map((frameId, order) => ({
  frameId, order, actor: order % 2 ? 'agent' as const : 'client' as const, action: frameId,
  breakpointIds: order === 1 ? ['failure-result'] : undefined,
  envelope: { jsonrpc: '2.0' as const }, provenance,
}));
const evaluation = (frameId: string, evaluationId: string) => ({
  frameId, evaluationId, diagnostic: { code: evaluationId, severity: 'error' as const, message: evaluationId, subject: { role: 'fact' as const, uri: 'case' }, related: [], evaluationId },
  evidence: [], verdicts: [], provenance,
});
const recording: ReplayRecording = {
  recordingId: 'recording', runId: 'run', frames,
  evaluations: [evaluation('failure', 'failure-evaluation'), evaluation('repair-pass', 'repair-evaluation')],
};
const snapshot = (controller: AcpReplayController) => controller.getState() as ReplaySnapshot;

describe('AcpReplayController', () => {
  it('makes direct breakpoint seek identical to stepping and rebuilds deterministically', () => {
    const direct = new AcpReplayController(recording);
    direct.seekBreakpoint('failure-result');
    const expected = structuredClone(direct.getState());

    const stepped = new AcpReplayController(recording);
    stepped.stepForward();
    expect(stepped.getState()).toEqual(expected);
    stepped.stepBack();
    stepped.stepForward();
    expect(stepped.getState()).toEqual(expected);
  });

  it('continues only to recorded evaluation frames and never exposes the future', () => {
    const controller = new AcpReplayController(recording);
    expect(snapshot(controller).evaluations).toEqual([]);
    controller.continueToDiagnostic();
    expect(snapshot(controller)).toMatchObject({ location: { cursor: { frameId: 'failure' } }, evaluations: [{ evaluationId: 'failure-evaluation' }] });
    controller.continueToDiagnostic();
    expect(snapshot(controller)).toMatchObject({ location: { cursor: { frameId: 'repair-pass' } }, evaluations: [{ evaluationId: 'failure-evaluation' }, { evaluationId: 'repair-evaluation' }] });
  });

  it('keeps selection and viewport independent, and reset reconstructs the first prefix', () => {
    const controller = new AcpReplayController(recording);
    controller.continueToDiagnostic();
    controller.select({ kind: 'evaluation', evaluationId: 'failure-evaluation' });
    controller.setViewport({ anchorFrameId: 'request', filter: 'delivery' });
    expect(snapshot(controller).location.cursor).toEqual({ kind: 'frame', frameId: 'failure' });
    controller.stepBack();
    expect(snapshot(controller)).toMatchObject({ selection: null, location: { viewport: { anchorFrameId: 'request', filter: 'delivery' } }, evaluations: [] });
    controller.stepForward();
    expect(snapshot(controller).evaluations).toHaveLength(1);
    controller.reset();
    expect(snapshot(controller)).toMatchObject({ location: { cursor: { frameId: 'request' }, selection: null }, evaluations: [] });
  });

  it('surfaces invalid frames and malformed recordings rather than falling forward', () => {
    const controller = new AcpReplayController(recording);
    expect(controller.seek('missing')).toEqual({ status: 'frame-not-found', frameId: 'missing' });
    const malformed = { ...recording, frames: [{ ...frames[0], order: 3 }] };
    expect(new AcpReplayController(malformed).getState()).toMatchObject({ status: 'invalid-recording' });
  });
});
