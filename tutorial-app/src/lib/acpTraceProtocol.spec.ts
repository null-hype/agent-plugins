import { describe, expect, it } from 'vitest';
import {
  buildAcpTraceState,
  deriveTraceView,
  describePendingLine,
  findDiagnosticFrame,
  frameFilePath,
  parseAcpTraceFixture,
  parseAcpTraceFixtureRef,
  resolveAcpTraceConfig,
  resolveAcpTraceFixture,
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
    expect(describePendingLine(state.nextTurn!)).toBe(
      'agent: reply with diagnostic  ->  awaiting recorded turn (Solve replays it)',
    );
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
    expect(findDiagnosticFrame(state.frames)?.envelope.result?._meta?.diagnostic?.code).toBe(
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

describe('resolveAcpTraceFixture', () => {
  const frameStore: Record<string, string> = {
    '/frame-a.json': JSON.stringify(clientFrame),
    '/frame-b.json': JSON.stringify(agentFrame),
  };
  const loadFrame = (frameId: string) => frameStore[frameFilePath('/acp-trace.json', frameId)];

  it('resolves frameIds into frames, in order', () => {
    const ref = parseAcpTraceFixtureRef(JSON.stringify({ scenario: 's', frameIds: ['a', 'b'] }));
    const fixture = resolveAcpTraceFixture(ref, loadFrame);

    expect(fixture.frames).toEqual([clientFrame, agentFrame]);
  });

  it('preserves nextTurn through a frameIds fixture -- CIT: the frame-split refactor once dropped this, making every ACP lesson report solved', () => {
    const ref = parseAcpTraceFixtureRef(
      JSON.stringify({ scenario: 's', frameIds: ['a'], nextTurn: { actor: 'agent', action: 'reply' } }),
    );
    const state = buildAcpTraceState({ revision: 1, fixture: resolveAcpTraceFixture(ref, loadFrame) });

    expect(state.solved).toBe(false);
    expect(state.nextTurn).toEqual({ actor: 'agent', action: 'reply' });
  });

  it('narrows to frameId plus surrounding context (previous/next frame)', () => {
    const ref = parseAcpTraceFixtureRef(JSON.stringify({ scenario: 's', frameIds: ['a', 'b'] }));

    // Only 2 frames exist, so "context around" either one is still both --
    // this is expected, not a bug: there's no third frame to exclude yet.
    expect(resolveAcpTraceFixture(ref, loadFrame, { frameId: 'a' }).frames).toEqual([clientFrame, agentFrame]);
    expect(resolveAcpTraceFixture(ref, loadFrame, { frameId: 'b' }).frames).toEqual([clientFrame, agentFrame]);
  });

  it('narrows to a real window once there are 3+ frames', () => {
    const store: Record<string, string> = { ...frameStore, '/frame-c.json': JSON.stringify(clientFrame) };
    const load = (frameId: string) => store[frameFilePath('/acp-trace.json', frameId)];
    const ref = parseAcpTraceFixtureRef(JSON.stringify({ scenario: 's', frameIds: ['a', 'b', 'c'] }));

    expect(resolveAcpTraceFixture(ref, load, { frameId: 'a' }).frames).toEqual([clientFrame, agentFrame]);
    expect(resolveAcpTraceFixture(ref, load, { frameId: 'c' }).frames).toEqual([agentFrame, clientFrame]);
  });

  it('ignores an unmatched frameId (returns the full trace, does not throw)', () => {
    const ref = parseAcpTraceFixtureRef(JSON.stringify({ scenario: 's', frameIds: ['a', 'b'] }));

    expect(resolveAcpTraceFixture(ref, loadFrame, { frameId: 'nope' }).frames).toEqual([clientFrame, agentFrame]);
  });

  it('falls back to embedded frames when there are no frameIds', () => {
    const ref = parseAcpTraceFixtureRef(JSON.stringify({ scenario: 's', frames: [clientFrame] }));

    expect(resolveAcpTraceFixture(ref, loadFrame, { frameId: 'a' }).frames).toEqual([clientFrame]);
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

describe('CIT-251: speakers, pins and verdict channels', () => {
  const provenance = { recordingId: 'budget-authority-v1#0', capturedAt: '2026-09-22T00:00:00Z', scripted: 'storyboard' };
  const pinFrame = (pins: unknown[], verdict?: unknown): AcpFrame => ({
    actor: 'client',
    action: 'ask',
    envelope: { jsonrpc: '2.0', id: 1, method: 'session/prompt', params: { sessionId: 's', prompt: [], _meta: { pins, verdict } } },
    provenance,
  } as AcpFrame);
  const replyFrame = (speaker: string, verdict: unknown, pins: unknown[] = []): AcpFrame => ({
    actor: speaker === 'supervisor' ? 'client' : 'agent',
    speaker,
    action: 'reply',
    envelope: { jsonrpc: '2.0', id: 1, result: { _meta: { pins, verdict } } },
    provenance,
  } as AcpFrame);

  it('names the speaker in the log line and the pending line', () => {
    expect(toWarmLogLine(replyFrame('jev', undefined)).raw.startsWith('jev (agent): reply')).toBe(true);
    expect(describePendingLine({ actor: 'client', speaker: 'supervisor', action: 'grant 1200 -> 1300' })).toBe(
      'supervisor (client): grant 1200 -> 1300  ->  awaiting recorded turn (Solve replays it)',
    );
  });

  it('reads _meta from params on requests and from result on responses', () => {
    const view = deriveTraceView([
      pinFrame([{ id: 'limit-v1', label: 'Limit rule v1', text: 'budget <= 1200' }], { channel: 'type', status: 'malformed', text: 'malformed' }),
      replyFrame('jev', { channel: 'type', status: 'well-formed', text: 'well-formed' }),
    ]);
    expect(view.scripted).toBe('storyboard');
    expect(view.pins.map((pin) => pin.id)).toEqual(['limit-v1']);
    expect(view.channels.type.map((entry) => entry.status)).toEqual(['malformed', 'well-formed']);
    expect(view.channels.budget).toEqual([]);
  });

  it('a grant marks the earlier budget entry and its rule superseded for the scoped object, without rewriting them', () => {
    const fail = { channel: 'budget', status: 'fail', rule: 'limit-v1', subject: 'proposal-P', text: 'FAIL @ v1' };
    const frames = [
      pinFrame([{ id: 'limit-v1', label: 'Limit rule v1', text: 'budget <= 1200' }]),
      replyFrame('checks', fail),
      replyFrame(
        'supervisor',
        { channel: 'authority', status: 'recorded', text: 'granted', actor: 'supervisor', from: 'limit-v1', to: 'limit-v2', scope: 'proposal-P', enforcement: 'simulated' },
        [{ id: 'limit-v2', label: 'Limit rule v2', text: 'budget <= 1300' }],
      ),
      replyFrame('checks', { channel: 'budget', status: 'pass', rule: 'limit-v2', subject: 'proposal-P', text: 'PASS @ v2' }),
    ];
    const view = deriveTraceView(frames);
    const superseded = { pin: 'limit-v2', scope: 'proposal-P', actor: 'supervisor' };

    expect(view.channels.budget[0]).toEqual({ ...fail, supersededBy: superseded });
    expect(view.channels.budget[1].supersededBy).toBeUndefined();
    expect(view.pins.find((pin) => pin.id === 'limit-v1')).toMatchObject({ text: 'budget <= 1200', supersededBy: superseded });
    // The frame itself is untouched: the view is derived, not written back.
    expect((frames[1].envelope.result?._meta?.verdict as { supersededBy?: unknown }).supersededBy).toBeUndefined();
  });

  it('a grant scoped to P changes nothing for another object, and flags that object reading the P-only rule', () => {
    const grant = { channel: 'authority', status: 'recorded', text: 'granted', actor: 'supervisor', from: 'limit-v1', to: 'limit-v2', scope: 'proposal-P', enforcement: 'simulated' };
    const view = deriveTraceView([
      pinFrame([{ id: 'limit-v1', label: 'Limit rule v1', text: 'budget <= 1200' }]),
      replyFrame('checks', { channel: 'budget', status: 'fail', rule: 'limit-v1', subject: 'proposal-Q', text: 'FAIL @ v1 (Q)' }),
      replyFrame('supervisor', grant, [{ id: 'limit-v2', label: 'Limit rule v2', text: 'budget <= 1300' }]),
      replyFrame('checks', { channel: 'budget', status: 'pass', rule: 'limit-v2', subject: 'proposal-Q', text: 'PASS @ v2 (Q)' }),
    ]);

    expect(view.channels.budget[0].supersededBy).toBeUndefined();
    expect(view.channels.budget[1].outOfScope).toEqual({ scope: 'proposal-P', actor: 'supervisor' });
  });

  it('refuses to re-pin an id: pinned objects are immutable', () => {
    const pin = { id: 'proposal-P', label: 'Proposal P', text: 'airfare 890 + ground 400' };
    expect(() => deriveTraceView([pinFrame([pin]), pinFrame([{ ...pin, text: 'airfare 890 + ground 300' }])])).toThrow(/immutable/);
  });

  it('a ghost-trace fixture has no pins, no verdicts and no scripted marker', () => {
    expect(deriveTraceView([clientFrame, agentFrame])).toEqual({
      scripted: null,
      pins: [],
      channels: { type: [], merge: [], budget: [], authority: [], review: [] },
    });
  });
});
