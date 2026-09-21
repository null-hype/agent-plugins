/**
 * CIT-229: the learner writes the Follower Maze protocol as reasons, one
 * `PROTON_PASS_AGENT_REASON=` line per message, and this module turns the text
 * into typed records. Nothing downstream compares strings: the world, the
 * declared effects and the static diagnostics all come from these records, and
 * are reconciled against deliveries (followerMaze.ts `check`), never against an
 * expected reason.
 *
 *   PROTON_PASS_AGENT_REASON=follow|10|20
 *   PROTON_PASS_AGENT_REASON=status|20 -> [10]      (an optional intended effect)
 *   PROTON_PASS_AGENT_REASON=unfollow|10|20
 *
 * The learner's seat is the agent: they make these claims. The static
 * diagnostics below (a linter over the typed input) and the legal-world count
 * are the supervisor's view of them. A reason has no sequence number; the
 * implementation is handed the line number as the message's identity, which is
 * the only thing the reorder-buffer model can order by.
 */
import worldJson from './fixtures/world.json';
import type { DeclaredEffect, EventKind, FollowerMazeEvent, FollowerMazeWorld } from './followerMaze';

export const REASON_PREFIX = 'PROTON_PASS_AGENT_REASON=';

export interface Reason {
  /** 1-based ordinal among the written reasons: the message's identity, not a protocol sequence. */
  line: number;
  /** 1-based line of the text it came from, where its diagnostics attach. */
  row: number;
  kind: 'follow' | 'unfollow' | 'status';
  fromUser: number;
  toUser: number | null;
  /** `null`: the reason declares no effect. */
  effect: number[] | null;
  raw: string;
}

/** A finding about the typed input alone -- a linter, no implementation involved. */
export interface StaticIssue {
  line: number;
  code: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface ParsedReasons {
  reasons: Reason[];
  issues: StaticIssue[];
  /** No error-severity issue: the reasons can be sent to the implementation. */
  ok: boolean;
}

export const REASON_COUNT = 4;
const CONNECTED: readonly number[] = worldJson.connectedUsers;
const KIND: Record<Reason['kind'], EventKind> = { follow: 'F', unfollow: 'U', status: 'S' };

const LINE = /^(follow|unfollow|status)\|(\d+)(?:\|(\d+))?(?:\s*->\s*\[\s*((?:\d+(?:\s*,\s*\d+)*)?)\s*\])?$/;

export function parseReasons(text: string): ParsedReasons {
  const reasons: Reason[] = [];
  const issues: StaticIssue[] = [];
  const physical = text.split('\n');
  // Blank lines and `#` comments (the log's own verdict rows) are not reasons.
  const written = physical.map((raw, index) => ({ raw: raw.trim(), row: index + 1 })).filter(({ raw }) => raw !== '' && !raw.startsWith('#'));

  written.forEach(({ raw: trimmed, row }, index) => {
    const line = index + 1;
    const fail = (code: string, message: string) => issues.push({ line: row, code, severity: 'error', message });
    if (!trimmed.startsWith(REASON_PREFIX)) return fail('reason-missing-prefix', `A reason line starts with ${REASON_PREFIX}`);
    const match = LINE.exec(trimmed.slice(REASON_PREFIX.length).trim());
    if (!match) return fail('reason-unparseable', 'Expected follow|from|to, unfollow|from|to or status|user, optionally followed by -> [users]');

    const [, kind, from, to, effect] = match as unknown as [string, Reason['kind'], string, string | undefined, string | undefined];
    if (kind === 'status' && to !== undefined) return fail('reason-unparseable', 'status takes one user: status|20');
    if (kind !== 'status' && to === undefined) return fail('reason-unparseable', `${kind} takes two users: ${kind}|10|20`);
    if (kind !== 'status' && effect !== undefined) return fail('reason-effect-unsupported', `Only a status reason can declare an effect; a ${kind} notifies by protocol rule`);

    const users = [Number(from), ...(to === undefined ? [] : [Number(to)]), ...(effect ? effect.split(',').map(Number) : [])];
    const absent = users.find((user) => !CONNECTED.includes(user));
    if (absent !== undefined) return fail('reason-disconnected-user', `User ${absent} is not connected: this world has {${CONNECTED.join(', ')}}. A message cannot be sent to a disconnected user`);

    reasons.push({
      line,
      row,
      kind,
      fromUser: Number(from),
      toUser: to === undefined ? null : Number(to),
      effect: kind !== 'status' || effect === undefined ? null : effect ? effect.split(',').map(Number) : [],
      raw: trimmed,
    });
  });

  if (issues.length === 0 && written.length !== REASON_COUNT) {
    issues.push({ line: written.at(-1)?.row ?? 1, code: 'reason-count', severity: 'error', message: `This protocol has ${REASON_COUNT} messages; ${written.length} reasons are written` });
  }
  for (const reason of reasons) {
    if (reason.kind === 'status' && reason.effect === null) {
      issues.push({
        line: reason.row,
        code: 'reason-unconstrained',
        severity: 'warning',
        message: `${reason.raw.slice(REASON_PREFIX.length)} declares no effect, so it permits every arrival order. Say who should receive it: -> [10] or -> []`,
      });
    }
  }
  return { reasons, issues, ok: !issues.some((issue) => issue.severity === 'error') };
}

/** The typed reasons as a world: the message's line number is its identity. */
export function reasonEvents(reasons: readonly Reason[]): FollowerMazeEvent[] {
  return reasons.map((reason) => {
    const kind = KIND[reason.kind];
    const parts = [reason.line, kind, reason.fromUser, ...(reason.toUser === null ? [] : [reason.toUser])];
    return { sequence: reason.line, kind, fromUser: reason.fromUser, toUser: reason.toUser, payload: parts.join('|') };
  });
}

export const declaredEffects = (reasons: readonly Reason[]): DeclaredEffect[] =>
  reasons.filter((reason) => reason.kind === 'status').map((reason) => ({ sequence: reason.line, recipients: reason.effect }));

/** The world for one arrival order (a permutation of the reasons' line numbers). */
export function reasonWorld(reasons: readonly Reason[], arrival: readonly number[]): FollowerMazeWorld {
  const bySequence = new Map(reasonEvents(reasons).map((event) => [event.sequence, event]));
  return { connectedUsers: CONNECTED, arrivals: arrival.map((line) => bySequence.get(line)!), declared: declaredEffects(reasons) };
}

/** The four bare reasons: nothing constrained, all 24 arrival orders legal. */
export const BARE_REASONS = [
  'follow|10|20',
  'status|20',
  'unfollow|10|20',
  'status|20',
].map((line) => REASON_PREFIX + line).join('\n');

/** The same four with the two statuses' intended effects: 4 of 24 orders legal. */
export const TIGHT_REASONS = [
  'follow|10|20',
  'status|20 -> [10]',
  'unfollow|10|20',
  'status|20 -> []',
].map((line) => REASON_PREFIX + line).join('\n');
