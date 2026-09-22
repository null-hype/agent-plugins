import { describe, expect, it } from 'vitest';
import {
  buildAcpTraceState,
  describeNextTurn,
  findDiagnosticFrame,
  parseAcpTraceFixture,
  resolveAcpTraceConfig,
  toWarmLogLine,
  type AcpFrame,
} from './acpTraceProtocol';

const clientFrame: AcpFrame = {
  actor: 'client',
  action: 'send prompt',
  envelope: {
    jsonrpc: '2.0',
    id: 7,
    method: 'session/prompt',
    params: {
      sessionId: 'sess_ghost-01',
      prompt: [{ type: 'text', text: "Why didn't user 10 get the status update?" }],
    },
  },
  provenance: { recordingId: 'ghost-trace-v1#0', capturedAt: '2026-09-15T00:00:00Z' },
};

const agentFrame: AcpFrame = {
  actor: 'agent',
  action: 'reply with diagnostic',
  envelope: {
    jsonrpc: '2.0',
    id: 7,
    result: {
      stopReason: 'end_turn',
      _meta: {
        diagnostic: {
          severity: 'error',
          code: 'fm-missing-delivery',
          message: 'required delivery 10 <- seq 2 is absent from the witness',
          subject: { role: 'fact', uri: 'fixtures/arrivals/4231.json', detail: 'arrival [4,2,3,1]' },
          related: [
            { role: 'axiom', uri: 'followerMaze.orderedRouting', detail: 'ordering errors surface as routing errors' },
          ],
          evaluationId: 'followerMaze.orderedRouting:arrival-4231',
        },
      },
    },
  },
  provenance: { recordingId: 'ghost-trace-v1#1', capturedAt: '2026-09-15T00:00:04Z' },
};

describe('resolveAcpTraceConfig', () => {
  it('reads custom.acpTrace', () => {
    expect(resolveAcpTraceConfig({ acpTrace: { traceFile: '/x.json', scenario: 's' } })).toEqual({
      traceFile: '/x.json',
      scenario: 's',
    });
  });

  it('returns null without custom.acpTrace', () => {
    expect(resolveAcpTraceConfig({ ruleTrace: {} })).toBeNull();
    expect(resolveAcpTraceConfig(undefined)).toBeNull();
  });
});

describe('parseAcpTraceFixture + buildAcpTraceState', () => {
  it('the starter file: one frame, a pending next turn, not solved', () => {
    const fixture = parseAcpTraceFixture(
      JSON.stringify({
        scenario: 'ghost-trace-diagnostic-v1',
        frames: [clientFrame],
        nextTurn: { actor: 'agent', action: 'reply with diagnostic' },
      }),
    );
    const state = buildAcpTraceState({ revision: 1, fixture });

    expect(state.solved).toBe(false);
    expect(state.frames).toEqual([clientFrame]);
    expect(describeNextTurn(state.nextTurn)).toBe('Agent: reply with diagnostic');
    expect(findDiagnosticFrame(state.frames)).toBeUndefined();
  });

  it('the solution file: both frames, nextTurn cleared, solved', () => {
    const fixture = parseAcpTraceFixture(
      JSON.stringify({
        scenario: 'ghost-trace-diagnostic-v1',
        frames: [clientFrame, agentFrame],
        nextTurn: null,
      }),
    );
    const state = buildAcpTraceState({ revision: 2, fixture });

    expect(state.solved).toBe(true);
    expect(state.nextTurn).toBeNull();
    expect(describeNextTurn(state.nextTurn)).toBeNull();
    expect(findDiagnosticFrame(state.frames)?.envelope.result?._meta?.diagnostic.code).toBe(
      'fm-missing-delivery',
    );
  });

  it('is deterministic: identical fixture text yields identical state but for the caller-supplied revision', () => {
    const text = JSON.stringify({ scenario: 's', frames: [clientFrame], nextTurn: null });
    const a = buildAcpTraceState({ revision: 1, fixture: parseAcpTraceFixture(text) });
    const b = buildAcpTraceState({ revision: 1, fixture: parseAcpTraceFixture(text) });

    expect(a).toEqual(b);
  });

  it('falls back to an empty fixture on unparsable text', () => {
    const state = buildAcpTraceState({ revision: 1, fixture: parseAcpTraceFixture('not json') });

    expect(state.frames).toEqual([]);
    expect(state.solved).toBe(false);
  });
});

describe('toWarmLogLine', () => {
  it('a sent request with no result yet: status "sent", real prompt text, no diagnostic', () => {
    const line = toWarmLogLine(clientFrame);

    expect(line.raw).toBe(
      'client: send prompt  ->  sent  session/prompt "Why didn\'t user 10 get the status update?"',
    );
    expect(line.diagnostic).toBeNull();
    expect(line.related).toEqual([]);
  });

  it('a result with a diagnostic: status is the diagnostic code, not a blanket "ok"', () => {
    const line = toWarmLogLine(agentFrame);

    expect(line.raw).toContain('fm-missing-delivery');
    expect(line.raw).not.toContain(' ok');
    expect(line.diagnostic).toEqual({
      severity: 'error',
      code: 'fm-missing-delivery',
      message: 'required delivery 10 <- seq 2 is absent from the witness',
    });
    expect(line.related).toEqual(agentFrame.envelope.result?._meta?.diagnostic.related);
  });

  it('a result with no diagnostic: status "ok", not the diagnostic code', () => {
    const line = toWarmLogLine({
      ...agentFrame,
      envelope: { ...agentFrame.envelope, result: { stopReason: 'end_turn' } },
    });

    expect(line.raw).toContain(' ok');
    expect(line.diagnostic).toBeNull();
  });
});
