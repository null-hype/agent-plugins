import type { AcpDiagnosticMeta } from './acpDiagnosticMeta.pkl';

/**
 * CIT-245: the first "ghost trace machine" lesson. Its custom.acpTrace
 * config, `acp-trace.json`'s shape, and the actor/action vocabulary below
 * are the contract any later lesson in this part follows to supply its own
 * recording, breakpoint, starting state, and solution state:
 *
 *   - `_files/<traceFile>` ships the fixture *before* the breakpoint: every
 *     frame already exchanged, plus `nextTurn` naming who/what comes next.
 *   - `_solution/<traceFile>` is the same fixture with that next frame
 *     appended and `nextTurn` cleared to `null` -- TutorialKit's own
 *     `_files` -> `_solution` swap (Solve) is what moves a lesson from one
 *     file to the other; this library only ever reads whatever the store
 *     currently holds at `traceFile`, the same way ruleTraceProtocol.ts
 *     reads whatever currently sits at `commandFile`.
 *   - A frame's `provenance` ties it back to the recording it was lifted
 *     from. `daggerCloudTraceUrl` is deferred (see this lesson's
 *     content.mdx) until real Playwright-recorded capture exists -- no
 *     frame here invents one.
 */

export type AcpEnvelope = {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  _meta?: AcpDiagnosticMeta;
};

export type AcpFrameProvenance = {
  recordingId: string;
  capturedAt: string;
  /** Deferred: absent until a real Dagger Cloud trace backs this fixture. */
  daggerCloudTraceUrl?: string;
};

export type AcpFrame = {
  actor: 'client' | 'agent';
  action: string;
  envelope: AcpEnvelope;
  provenance: AcpFrameProvenance;
};

export type AcpNextTurn = {
  actor: AcpFrame['actor'];
  action: string;
};

export type AcpTraceFixture = {
  scenario: string;
  frames: AcpFrame[];
  nextTurn: AcpNextTurn | null;
};

export type AcpTraceConfig = {
  traceFile: string;
  scenario: string;
};

export type AcpTraceState = {
  revision: number;
  scenario: string;
  frames: AcpFrame[];
  solved: boolean;
  /** What pressing Solve reveals, or null once nothing is left to solve. */
  nextTurn: AcpNextTurn | null;
};

const DEFAULT_CONFIG: AcpTraceConfig = {
  traceFile: '/acp-trace.json',
  scenario: 'ghost-trace-diagnostic-v1',
};

const EMPTY_FIXTURE: AcpTraceFixture = {
  scenario: DEFAULT_CONFIG.scenario,
  frames: [],
  nextTurn: null,
};

export function resolveAcpTraceConfig(customValue: unknown): AcpTraceConfig | null {
  if (!customValue || typeof customValue !== 'object') {
    return null;
  }

  const record = customValue as Record<string, unknown>;
  const acpTrace = record.acpTrace;

  if (!acpTrace || typeof acpTrace !== 'object') {
    return null;
  }

  const acpTraceRecord = acpTrace as Record<string, unknown>;

  return {
    traceFile: readString(acpTraceRecord.traceFile, DEFAULT_CONFIG.traceFile),
    scenario: readString(acpTraceRecord.scenario, DEFAULT_CONFIG.scenario),
  };
}

export function parseAcpTraceFixture(value: string | Uint8Array | undefined): AcpTraceFixture {
  const text = valueToText(value);

  if (!text.trim()) {
    return EMPTY_FIXTURE;
  }

  try {
    const parsed = JSON.parse(text) as Partial<AcpTraceFixture>;

    return {
      scenario: typeof parsed.scenario === 'string' ? parsed.scenario : EMPTY_FIXTURE.scenario,
      frames: Array.isArray(parsed.frames) ? parsed.frames : [],
      nextTurn: parsed.nextTurn ?? null,
    };
  } catch (_error) {
    return EMPTY_FIXTURE;
  }
}

export function valueToText(value: string | Uint8Array | undefined) {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value);
  }

  return '';
}

export function buildAcpTraceState(options: {
  revision: number;
  fixture: AcpTraceFixture;
  scenario?: string;
}): AcpTraceState {
  const { revision, fixture, scenario } = options;

  return {
    revision,
    scenario: scenario ?? fixture.scenario,
    frames: fixture.frames,
    solved: fixture.nextTurn === null && fixture.frames.length > 0,
    nextTurn: fixture.nextTurn,
  };
}

/** The frame a diagnostic actually lives on, if any -- read by both previews. */
export function findDiagnosticFrame(frames: readonly AcpFrame[]): AcpFrame | undefined {
  return frames.find((frame) => frame.envelope._meta?.diagnostic);
}

/** Solve's button label: "<Actor>: <action>", e.g. "Agent: reply with diagnostic". */
export function describeNextTurn(nextTurn: AcpNextTurn | null): string | null {
  if (!nextTurn) {
    return null;
  }

  const actor = nextTurn.actor === 'agent' ? 'Agent' : 'Client';
  return `${actor}: ${nextTurn.action}`;
}

function readString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}
