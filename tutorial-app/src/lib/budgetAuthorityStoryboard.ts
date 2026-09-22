import type { AcpFrame, AcpNextTurn, AcpPin, AcpTraceFixture, AcpVerdict } from './acpTraceProtocol';

/**
 * CIT-251: the CIT-250 story as five ACP turns in one session, built with
 * CIT-249's method (one `@tutorial` storyboard, one top-level step per turn,
 * see tests/budget-authority.tutorial.spec.ts). This module is the pure
 * part: given what the storyboard actually computed (the merged proposal's
 * git tree), it returns each turn's incoming frame, its recorded reply and
 * who acts next. Nothing here is a live capture -- every frame carries
 * `provenance.scripted` and the client pane says so.
 *
 * Which parts are computed and which are stated:
 *   - computed: the merge (a real `git merge` in the storyboard, its tree id
 *     and conflict count passed in here) and both budget evaluations
 *     (`evaluateBudget` below, over the same proposal and rule objects the
 *     frames pin).
 *   - stated: Jev's `YES · 0.94` is a labelled stub, not a recorded answer;
 *     the supervisor's grant is a record, and nothing in the replay enforces
 *     it (`enforcement: 'simulated'`).
 */

export const SCENARIO = 'budget-authority-v1';
export const SESSION_ID = 'sess_budget-01';
export const SCRIPTED = 'CIT-251 storyboard';

export const PROPOSAL_LINES = [
  { item: 'airfare', amount: 890 },
  { item: 'ground', amount: 400 },
] as const;

export const LIMIT_V1 = { id: 'limit-v1', version: 'v1', limit: 1200 } as const;
export const LIMIT_V2 = { id: 'limit-v2', version: 'v2', limit: 1300 } as const;

/** Jev's question, verbatim: the same proposal and rule the checks later evaluate. */
export const QUESTION = 'Does proposal P (airfare 890 + ground 400) fit within limit rule v1 (1200)?';
export const WORKER_REASON = 'fits, roughly 1.2k all in';

export type BudgetEvaluation = {
  total: number;
  limit: number;
  version: string;
  status: 'pass' | 'fail';
};

export function evaluateBudget(
  lines: readonly { amount: number }[],
  rule: { version: string; limit: number },
): BudgetEvaluation {
  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  return { total, limit: rule.limit, version: rule.version, status: total <= rule.limit ? 'pass' : 'fail' };
}

export type MergeResult = {
  /** `git rev-parse HEAD:proposal` after the merge: P's identity from turn 2 on. */
  tree: string;
  conflicts: number;
};

export type StoryTurn = {
  title: string;
  incoming: AcpFrame;
  nextTurn: AcpNextTurn;
  replies: AcpFrame[];
};

const provenance = (index: number) => ({
  recordingId: `${SCENARIO}#${index}`,
  capturedAt: 'n/a (scripted)',
  scripted: SCRIPTED,
});

const prompt = (id: number, text: string, meta: object, index: number): AcpFrame => ({
  actor: 'client',
  action: 'send prompt',
  envelope: {
    jsonrpc: '2.0',
    id,
    method: 'session/prompt',
    params: { sessionId: SESSION_ID, prompt: [{ type: 'text', text }], _meta: meta },
  },
  provenance: provenance(index),
});

const response = (
  speaker: string,
  actor: AcpFrame['actor'],
  action: string,
  id: number | string,
  result: Record<string, unknown>,
  index: number,
): AcpFrame => ({
  actor,
  speaker,
  action,
  envelope: { jsonrpc: '2.0', id, result },
  provenance: provenance(index),
});

const toolUpdate = (
  speaker: string,
  action: string,
  update: Record<string, unknown>,
  meta: object,
  index: number,
): AcpFrame => ({
  actor: 'agent',
  speaker,
  action,
  envelope: {
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId: SESSION_ID, update: { sessionUpdate: 'tool_call_update', ...update }, _meta: meta },
  },
  provenance: provenance(index),
});

export function buildBudgetAuthorityTurns(merge: MergeResult): StoryTurn[] {
  if (merge.conflicts !== 0) {
    throw new Error(`the storyboard's merge reported ${merge.conflicts} conflict(s); this story needs a clean merge`);
  }

  const short = merge.tree.slice(0, 12);
  const [airfare, ground] = PROPOSAL_LINES;
  const sum = `${airfare.amount} + ${ground.amount}`;
  const underV1 = evaluateBudget(PROPOSAL_LINES, LIMIT_V1);
  const underV2 = evaluateBudget(PROPOSAL_LINES, LIMIT_V2);

  const pins = {
    question: { id: 'question', label: 'Question', text: QUESTION },
    limitV1: { id: LIMIT_V1.id, label: 'Limit rule v1', text: `budget ≤ ${LIMIT_V1.limit}` },
    answer: {
      id: 'jev-answer',
      label: "Jev's answer",
      text: `YES · 0.94 (to the question above)`,
      simulated: 'stub, not a recorded Jev answer',
    },
    branchAirfare: { id: 'branch-airfare', label: 'Branch airfare', text: `airfare ${airfare.amount}` },
    branchGround: { id: 'branch-ground', label: 'Branch ground', text: `ground ${ground.amount}` },
    proposal: { id: 'proposal-P', label: 'Proposal P', text: `airfare ${airfare.amount} + ground ${ground.amount} · tree ${short}` },
    limitV2: {
      id: LIMIT_V2.id,
      label: 'Limit rule v2',
      text: `budget ≤ ${LIMIT_V2.limit} · applies to Proposal P (tree ${short}) only`,
    },
  } satisfies Record<string, AcpPin>;

  const proposalEvidence = {
    role: 'fact' as const,
    uri: 'proposal/P',
    revision: `tree ${short}`,
    detail: `airfare ${airfare.amount} + ground ${ground.amount} = ${underV1.total}`,
  };

  const budgetVerdict = (evaluation: BudgetEvaluation, rule: string, suffix = ''): AcpVerdict => ({
    channel: 'budget',
    status: evaluation.status,
    rule,
    subject: pins.proposal.id,
    text:
      `${evaluation.status.toUpperCase()} @ ${evaluation.version}: ${sum} = ${evaluation.total} ` +
      `${evaluation.status === 'pass' ? '≤' : '>'} ${evaluation.limit}${suffix}`,
  });

  return [
    {
      title: 'Jev types the answer',
      incoming: prompt(
        1,
        QUESTION,
        {
          pins: [pins.question, pins.limitV1],
          verdict: {
            channel: 'type',
            status: 'malformed',
            text: `malformed · worker reason "${WORKER_REASON}" is free text, not a typed decision`,
          },
        },
        0,
      ),
      nextTurn: { actor: 'agent', speaker: 'jev', action: 'type the answer' },
      replies: [
        response('jev', 'agent', 'type the answer', 1, {
          stopReason: 'end_turn',
          _meta: {
            pins: [pins.answer],
            verdict: { channel: 'type', status: 'well-formed', text: 'well-formed · {answer: YES, confidence: 0.94} (simulated)' },
          },
        }, 1),
      ],
    },
    {
      title: 'Git merges the two branches',
      incoming: prompt(2, 'Merge branch airfare and branch ground into proposal P.', { pins: [pins.branchAirfare, pins.branchGround] }, 2),
      nextTurn: { actor: 'agent', speaker: 'git', action: 'merge' },
      replies: [
        response('git', 'agent', 'merge', 2, {
          stopReason: 'end_turn',
          _meta: {
            pins: [pins.proposal],
            verdict: { channel: 'merge', status: 'clean', text: `clean · ${merge.conflicts} conflicts` },
          },
        }, 3),
      ],
    },
    {
      title: 'Checks evaluate P under v1',
      incoming: prompt(3, 'Run the budget check on proposal P.', {}, 4),
      nextTurn: { actor: 'agent', speaker: 'checks', action: 'evaluate' },
      replies: [
        toolUpdate(
          'checks',
          'evaluate',
          { toolCallId: 'budget-check-1', status: 'completed', title: `Budget check on P @ ${LIMIT_V1.version}` },
          {
            verdict: budgetVerdict(underV1, LIMIT_V1.id),
            diagnostic: {
              severity: 'error',
              code: 'budget-exceeds-limit',
              message: `Proposal P totals ${underV1.total}, over limit rule v1 (${LIMIT_V1.limit}).`,
              subject: proposalEvidence,
              related: [
                proposalEvidence,
                { role: 'axiom', uri: 'rules/limit', revision: LIMIT_V1.version, detail: `budget ≤ ${LIMIT_V1.limit}` },
                {
                  role: 'observation',
                  uri: 'jev/answer',
                  detail: `YES · 0.94 (simulated) to the same question -- contradicted: ${underV1.total} > ${LIMIT_V1.limit}`,
                },
              ],
              evaluationId: `budget-check-1@${LIMIT_V1.version}`,
            },
          },
          5,
        ),
      ],
    },
    {
      title: 'Supervisor grants 1200 → 1300',
      incoming: {
        actor: 'agent',
        speaker: 'worker',
        action: 'request permission',
        envelope: {
          jsonrpc: '2.0',
          id: 'perm-1',
          method: 'session/request_permission',
          params: {
            sessionId: SESSION_ID,
            toolCall: {
              toolCallId: 'limit-change-1',
              title: `Raise limit rule v1 ${LIMIT_V1.limit} → ${LIMIT_V2.limit} for proposal P`,
              status: 'pending',
            },
            options: [
              { optionId: 'grant-for-p', name: `Grant v2 (${LIMIT_V2.limit}) for proposal P`, kind: 'allow_once' },
              { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
            ],
          },
        },
        provenance: provenance(6),
      },
      nextTurn: { actor: 'client', speaker: 'supervisor', action: `grant ${LIMIT_V1.limit} → ${LIMIT_V2.limit}` },
      replies: [
        response('supervisor', 'client', `grant ${LIMIT_V1.limit} → ${LIMIT_V2.limit}`, 'perm-1', {
          outcome: { outcome: 'selected', optionId: 'grant-for-p' },
          _meta: {
            pins: [pins.limitV2],
            verdict: {
              channel: 'authority',
              status: 'recorded',
              actor: 'supervisor',
              from: LIMIT_V1.id,
              to: LIMIT_V2.id,
              scope: pins.proposal.id,
              enforcement: 'simulated',
              text:
                `granted by supervisor: v1 ${LIMIT_V1.limit} → v2 ${LIMIT_V2.limit} · ` +
                `scope Proposal P (tree ${short}, unchanged)`,
            },
          },
        }, 7),
      ],
    },
    {
      title: 'Checks re-evaluate P under v2',
      incoming: toolUpdate(
        'checks',
        'queue re-evaluation',
        { toolCallId: 'budget-check-2', status: 'pending', title: `Re-run the budget check on P @ ${LIMIT_V2.version}` },
        {},
        8,
      ),
      nextTurn: { actor: 'agent', speaker: 'checks', action: 're-evaluate' },
      replies: [
        response('checks', 'agent', 're-evaluate', 3, {
          stopReason: 'end_turn',
          _meta: {
            verdict: budgetVerdict(underV2, LIMIT_V2.id, ' (granted by supervisor)'),
            diagnostic: {
              severity: 'info',
              code: 'budget-within-limit',
              message: `Proposal P totals ${underV2.total}, within limit rule v2 (${LIMIT_V2.limit}) as granted for P.`,
              subject: proposalEvidence,
              related: [
                proposalEvidence,
                { role: 'axiom', uri: 'rules/limit', revision: LIMIT_V2.version, detail: `budget ≤ ${LIMIT_V2.limit}, Proposal P only` },
                {
                  role: 'grant',
                  uri: 'authority/limit-change-1',
                  detail: 'granted by supervisor · recorded, enforcement simulated',
                },
              ],
              evaluationId: `budget-check-2@${LIMIT_V2.version}`,
            },
          },
        }, 9),
      ],
    },
  ];
}

export type StoryLesson = {
  title: string;
  /** Lesson n's `_files`: lesson n-1's `_solution` plus this turn's incoming frame. */
  start: AcpTraceFixture;
  /** Lesson n's `_solution`: the start plus the recorded reply, nothing pending. */
  end: AcpTraceFixture;
};

export function buildBudgetAuthorityLessons(merge: MergeResult): StoryLesson[] {
  let frames: AcpFrame[] = [];
  return buildBudgetAuthorityTurns(merge).map((turn) => {
    const startFrames = [...frames, turn.incoming];
    const endFrames = [...startFrames, ...turn.replies];
    frames = endFrames;
    return {
      title: turn.title,
      start: { scenario: SCENARIO, frames: startFrames, nextTurn: turn.nextTurn },
      end: { scenario: SCENARIO, frames: endFrames, nextTurn: null },
    };
  });
}

/** The exact bytes a lesson's `acp-trace.json` holds. */
export function serializeFixture(fixture: AcpTraceFixture): string {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}
