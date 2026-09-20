import {
  BASE,
  CANDIDATE_A,
  CANDIDATE_B,
  REPAIR,
  compose,
  evaluateFlows,
  violationToGovernance,
  type CandidateInput,
  type ComparisonContext,
  type FlowEvaluation,
  type Integration,
} from './integrationScenario';
import type { GovernanceDiagnostic } from './governanceDiagnostic';

/**
 * CIT-176 session model. A recorded evaluation and a recorded approval are
 * each keyed to an integration revision; whether they are current is
 * DERIVED by comparing that key with the revision of today's inputs, never
 * stored as a flag. The check outcome and the approval are separate fields.
 */
export interface EvaluationRecord {
  integrationRevision: string;
  evaluation: FlowEvaluation;
}

export interface ApprovalRecord {
  integrationRevision: string;
  simulated: true;
}

export interface SessionState {
  repairApplied: boolean;
  evaluation: EvaluationRecord | null;
  approval: ApprovalRecord | null;
}

export type SessionAction =
  | { type: 'evaluate' }
  | { type: 'applyRepair' }
  | { type: 'approve' }
  | { type: 'reset' };

export const INITIAL_STATE: SessionState = { repairApplied: false, evaluation: null, approval: null };

export function currentInputs(state: SessionState): { a: CandidateInput; b: CandidateInput; integration: Integration } {
  const a = CANDIDATE_A;
  const b = state.repairApplied ? REPAIR.to : CANDIDATE_B;
  return { a, b, integration: compose(a, b) };
}

export function reduce(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'evaluate': {
      const { integration } = currentInputs(state);
      if (!integration.evaluation) return state;
      return { ...state, evaluation: { integrationRevision: integration.revision, evaluation: integration.evaluation } };
    }
    case 'applyRepair':
      return state.repairApplied ? state : { ...state, repairApplied: true };
    case 'approve': {
      const { integration } = currentInputs(state);
      const e = state.evaluation;
      // approval binds to exactly the verified, current revision
      if (!e || e.integrationRevision !== integration.revision || e.evaluation.outcome !== 'pass') return state;
      return { ...state, approval: { integrationRevision: integration.revision, simulated: true } };
    }
    case 'reset':
      return INITIAL_STATE;
  }
}

export type IntegrationStatus = 'pending' | 'failed' | 'passed' | 'stale' | 'conflict';
export type ApprovalStatus = 'none' | 'granted' | 'stale';

export interface View {
  base: typeof BASE;
  candidates: { candidate: CandidateInput; check: FlowEvaluation }[];
  integration: Integration;
  status: IntegrationStatus;
  /** the recorded evaluation, shown as current only when status is failed/passed */
  recorded: EvaluationRecord | null;
  approval: ApprovalStatus;
  staleApproval: ApprovalRecord | null;
  diagnostic: { diagnostic: GovernanceDiagnostic; comparison: ComparisonContext } | null;
}

export function deriveView(state: SessionState): View {
  const { a, b, integration } = currentInputs(state);
  const recorded = state.evaluation;
  let status: IntegrationStatus;
  if (!integration.merge.ok) status = 'conflict';
  else if (!recorded) status = 'pending';
  else if (recorded.integrationRevision !== integration.revision) status = 'stale';
  else status = recorded.evaluation.outcome === 'pass' ? 'passed' : 'failed';

  const approval: ApprovalStatus = !state.approval
    ? 'none'
    : state.approval.integrationRevision === integration.revision
      ? 'granted'
      : 'stale';

  const current = status === 'failed' && recorded ? recorded.evaluation : null;
  const diagnostic =
    current && current.violations.length ? violationToGovernance(current.violations[0], a, b, integration) : null;

  return {
    base: BASE,
    candidates: [a, b].map((candidate) => ({ candidate, check: evaluateFlows(candidate.text) })),
    integration,
    status,
    recorded,
    approval,
    staleApproval: approval === 'stale' ? state.approval : null,
    diagnostic,
  };
}

/** Build a state by replaying real actions, so stories never hand-write a verdict. */
export function replay(...actions: SessionAction[]): SessionState {
  return actions.reduce(reduce, INITIAL_STATE);
}
