import type { AcpDiagnosticMeta, EvidenceLocation } from './acpDiagnosticMeta.pkl';

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

/**
 * `_meta` is not a sibling of `result` on the JSON-RPC envelope -- the ACP
 * SDK's own response types (e.g. `PromptResponse` in
 * agentclientprotocol/typescript-sdk's schema/types.gen.ts) carry `_meta`
 * as a field *inside* the result payload itself, alongside `stopReason`
 * etc. A conforming recording's diagnostic lives at `result._meta`, so
 * that's the only place this library (or a renderer) looks for one.
 */
export type AcpResult = {
  [key: string]: unknown;
  _meta?: AcpTurnMeta;
};

/**
 * CIT-251: what a frame's `_meta` may carry besides a diagnostic. All three
 * are optional, so a ghost-trace fixture (diagnostic only) is unchanged.
 *
 *   - `pins`: fixed objects the story refers to by name (a question, a
 *     proposal, a rule version). A pin is immutable: once a frame pins an
 *     id, no later frame may pin the same id again (`deriveTraceView`
 *     rejects it). A new rule version is a new pin, not an edit.
 *   - `verdict`: one entry in exactly one verdict channel. Channels are kept
 *     apart on purpose -- a well-formed type, a clean merge, a budget result
 *     and a recorded grant are different claims and must not share one
 *     pass/fail indicator.
 *
 * `_meta` sits inside `result` on a response and inside `params` on a
 * request or notification (ACP's own placement for both); `metaOf` reads
 * whichever one the envelope has.
 */
export type AcpTurnMeta = Partial<AcpDiagnosticMeta> & {
  pins?: AcpPin[];
  verdict?: AcpVerdict;
};

export type AcpPin = {
  id: string;
  label: string;
  text: string;
  /** Set when the pinned value is a labelled stand-in, not recorded output. */
  simulated?: string;
};

export type AcpVerdict =
  | { channel: 'type'; status: 'malformed' | 'well-formed'; text: string }
  | { channel: 'merge'; status: 'clean' | 'conflicted'; text: string }
  | {
      channel: 'budget';
      status: 'pass' | 'fail';
      text: string;
      /** Pin id of the rule this evaluation read, e.g. `limit-v1`. */
      rule: string;
      /** Pin id of the object evaluated, e.g. `proposal-P`. */
      subject: string;
    }
  | {
      channel: 'authority';
      status: 'recorded';
      text: string;
      actor: string;
      /** Pin ids: the rule replaced, the rule granted, the object it applies to. */
      from: string;
      to: string;
      scope: string;
      /** `simulated`: the record exists, nothing in the replay enforces it. */
      enforcement: 'simulated' | 'enforced';
    }
  | {
      channel: 'review';
      status: 'pending' | 'approved';
      text: string;
    };

export type AcpVerdictChannel = AcpVerdict['channel'];
export const VERDICT_CHANNELS: readonly AcpVerdictChannel[] = ['type', 'merge', 'budget', 'authority', 'review'];

export type AcpEnvelope = {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: AcpResult;
};

export type AcpFrameProvenance = {
  recordingId: string;
  capturedAt: string;
  /**
   * CIT-251: set on a frame authored by a storyboard rather than captured
   * from a live exchange. The client pane says so once, above the log.
   */
  scripted?: string;
  /** Deferred: absent until a real Dagger Cloud trace backs this fixture. */
  daggerCloudTraceUrl?: string;
};

export type AcpFrame = {
  actor: 'client' | 'agent';
  /**
   * CIT-251: who, on that side of the protocol, this frame speaks for
   * (`jev`, `git`, `checks`, `supervisor`). ACP itself only has the two
   * roles; the speaker is what the pending line and the log name.
   */
  speaker?: string;
  action: string;
  envelope: AcpEnvelope;
  provenance: AcpFrameProvenance;
};

export type AcpNextTurn = {
  actor: AcpFrame['actor'];
  speaker?: string;
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

/**
 * A fixture file's on-disk shape after the frame-{id}.json split: either
 * `frames` embedded directly (ghost-trace lessons, unchanged) or `frameIds`
 * naming per-frame files a caller resolves via `loadFrame`. Both bridges
 * (the real app's AcpTraceBridge, Storybook's deriveAcpTraceState) read this
 * same shape so neither can drift from the other -- see the frame-split
 * refactor's regression, where an ad hoc reconstruction in one consumer
 * silently dropped `nextTurn` (every ACP lesson reported `solved: true`).
 */
export type AcpTraceFixtureRef = {
  scenario: string;
  frames?: AcpFrame[];
  frameIds?: string[];
  nextTurn?: AcpNextTurn | null;
};

export function parseAcpTraceFixtureRef(value: string | Uint8Array | undefined): AcpTraceFixtureRef {
  const text = valueToText(value);

  if (!text.trim()) {
    return { scenario: DEFAULT_CONFIG.scenario };
  }

  try {
    return JSON.parse(text) as AcpTraceFixtureRef;
  } catch (_error) {
    return { scenario: DEFAULT_CONFIG.scenario };
  }
}

/** Given a frame id, returns that frame file's raw text (or undefined if missing). */
export type AcpFrameLoader = (frameId: string) => string | Uint8Array | undefined;

/**
 * Resolves a fixture reference into the full fixture `buildAcpTraceState`
 * consumes: embedded `frames` pass through unchanged; `frameIds` are loaded
 * one file per id via `loadFrame` and parsed in order. `frameId`, when given
 * and the fixture has `frameIds`, narrows the result to that frame plus its
 * surrounding context (previous frame, next frame) -- frame-by-frame
 * traversal for a single lesson's trace, not an isolated frame with no
 * decision/consequence around it. An id not found in `frameIds` is ignored
 * (the full trace is returned), the same graceful fallback as a fixture
 * with no `frameIds` at all, rather than throwing out of a story's
 * render().
 */
export function resolveAcpTraceFixture(
  ref: AcpTraceFixtureRef,
  loadFrame: AcpFrameLoader,
  options?: { frameId?: string },
): AcpTraceFixture {
  const frameIds = ref.frameIds;
  let frames =
    frameIds && frameIds.length > 0
      ? frameIds.map((id) => parseFrame(loadFrame(id))).filter((frame): frame is AcpFrame => frame !== null)
      : ref.frames ?? [];

  if (options?.frameId && frameIds) {
    const index = frameIds.indexOf(options.frameId);
    if (index !== -1) {
      frames = frames.slice(Math.max(0, index - 1), index + 2);
    }
  }

  return {
    scenario: ref.scenario ?? DEFAULT_CONFIG.scenario,
    frames,
    nextTurn: ref.nextTurn ?? null,
  };
}

function parseFrame(value: string | Uint8Array | undefined): AcpFrame | null {
  const text = valueToText(value);

  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as AcpFrame;
  } catch (_error) {
    return null;
  }
}

/** The `frame-{id}.json` sibling of a `traceFile` path, e.g. `/frame-x.json`. */
export function frameFilePath(traceFile: string, frameId: string): string {
  return traceFile.replace(/[^/]+$/, `frame-${frameId}.json`);
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
  return frames.find((frame) => metaOf(frame.envelope)?.diagnostic);
}

/** A response carries `_meta` in `result`; a request or notification in `params`. */
export function metaOf(envelope: AcpEnvelope): AcpTurnMeta | undefined {
  if (envelope.result?._meta) return envelope.result._meta;
  const params = envelope.params;
  if (params && typeof params === 'object' && '_meta' in params) {
    return (params as { _meta?: AcpTurnMeta })._meta;
  }
  return undefined;
}

/** `jev (agent)` when a frame names its speaker, else the bare protocol role. */
export function describeActor(turn: { actor: AcpFrame['actor']; speaker?: string }): string {
  return turn.speaker ? `${turn.speaker} (${turn.actor})` : turn.actor;
}

/**
 * The client pane's last line while a turn is pending. It names who acts
 * next and says Solve *replays* a recorded turn: the viewer observes, they
 * do not take the action themselves (CIT-251).
 */
export function describePendingLine(nextTurn: AcpNextTurn): string {
  return `${describeActor(nextTurn)}: ${nextTurn.action}  ->  awaiting recorded turn (Solve replays it)`;
}

export type AcpPinView = AcpPin & {
  /** Set once an authority record replaces this rule for `scope`. */
  supersededBy?: { pin: string; scope: string; actor: string };
};

export type AcpVerdictView = AcpVerdict & {
  /** Budget entries only: the rule they read has since been replaced for their object. */
  supersededBy?: { pin: string; scope: string; actor: string };
  /**
   * Budget entries only: the entry read a rule that was granted for a
   * different object. A scoped grant is not a global limit change.
   */
  outOfScope?: { scope: string; actor: string };
};

export type AcpTraceView = {
  scripted: string | null;
  pins: AcpPinView[];
  channels: Record<AcpVerdictChannel, AcpVerdictView[]>;
};

/**
 * CIT-251: everything the client pane shows above the log, derived from
 * the frames alone (no second source of truth). Earlier evaluations keep
 * the rule they read: a grant never rewrites a budget entry, it only lets
 * the view say that entry's rule has been superseded for its object.
 */
export function deriveTraceView(frames: readonly AcpFrame[]): AcpTraceView {
  const pins: AcpPinView[] = [];
  const channels: AcpTraceView['channels'] = { type: [], merge: [], budget: [], authority: [], review: [] };
  let scripted: string | null = null;

  for (const frame of frames) {
    scripted ??= frame.provenance?.scripted ?? null;
    const meta = metaOf(frame.envelope);
    for (const pin of meta?.pins ?? []) {
      if (pins.some((existing) => existing.id === pin.id)) {
        throw new Error(`pin "${pin.id}" is pinned twice; a pinned object is immutable -- pin a new id instead`);
      }
      pins.push({ ...pin });
    }
    if (meta?.verdict) channels[meta.verdict.channel].push({ ...meta.verdict });
  }

  // A grant replaces `from` with `to` for its scope only: a budget entry about
  // that object that read `from` is superseded; an entry about any other
  // object that read `to` is using a rule that was never granted for it.
  for (const grant of channels.authority) {
    if (grant.channel !== 'authority') continue;
    const supersededBy = { pin: grant.to, scope: grant.scope, actor: grant.actor };
    for (const pin of pins) if (pin.id === grant.from) pin.supersededBy = supersededBy;
    for (const entry of channels.budget) {
      if (entry.channel !== 'budget') continue;
      if (entry.rule === grant.from && entry.subject === grant.scope) entry.supersededBy = supersededBy;
      if (entry.rule === grant.to && entry.subject !== grant.scope) entry.outOfScope = { scope: grant.scope, actor: grant.actor };
    }
  }

  return { scripted, pins, channels };
}

export type AcpWarmLogDiagnostic = {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
};

export type AcpWarmLogLine = {
  raw: string;
  diagnostic: AcpWarmLogDiagnostic | null;
  related: EvidenceLocation[];
};

/**
 * CIT-247: the client pane's diagnostics used to print as a bare line inside
 * a `#region` block. This maps one frame onto the same `{raw, diagnostic,
 * related}` shape the warm log renderer already knows how to draw
 * (`WarmLogRecord` in followerMazeLog.ts) -- the client pane's template
 * duplicates the marker/hover/CodeLens/evidence-widget code that reads this
 * shape (templates are plain HTML/JS strings with no shared module system
 * between them), but the *mapping* from a frame to that shape lives here
 * once, real and unit-tested, not reinvented per template.
 */
export function toWarmLogLine(frame: AcpFrame): AcpWarmLogLine {
  const { envelope } = frame;
  const diagnostic = metaOf(envelope)?.diagnostic;
  const promptText = extractPromptText(envelope.params);
  const status = diagnostic ? diagnostic.code : envelope.result !== undefined ? 'ok' : 'sent';
  const call = envelope.method ? `${envelope.method}${promptText ? ` "${promptText}"` : ''}` : null;

  return {
    raw: [`${describeActor(frame)}: ${frame.action}`, '->', status, call].filter(Boolean).join('  '),
    diagnostic: diagnostic ? { severity: diagnostic.severity, code: diagnostic.code, message: diagnostic.message } : null,
    related: diagnostic?.related ?? [],
  };
}

/**
 * `session/prompt`'s `params.prompt` is a list of content blocks; only `text`
 * blocks render. A `session/request_permission` or tool-call `session/update`
 * has no prompt; its tool call's `title` is what a reader needs instead.
 */
function extractPromptText(params: unknown): string | null {
  if (!params || typeof params !== 'object') {
    return null;
  }

  const toolCall = (params as { toolCall?: { title?: unknown }; update?: { title?: unknown } }).toolCall ??
    (params as { update?: { title?: unknown } }).update;
  if (toolCall && typeof toolCall.title === 'string') {
    return toolCall.title;
  }

  if (!('prompt' in params)) {
    return null;
  }

  const prompt = (params as { prompt?: unknown }).prompt;

  if (!Array.isArray(prompt)) {
    return null;
  }

  const texts = prompt
    .filter(
      (block): block is { type: 'text'; text: string } =>
        Boolean(block) && typeof block === 'object' && (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string',
    )
    .map((block) => block.text);

  return texts.length > 0 ? texts.join(' ') : null;
}

function readString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}
