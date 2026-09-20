import { CHECK_ID, FILE_PATH, revLoc } from './integrationScenario';
import type { EvidenceLocation, GovernanceDiagnostic } from './governanceDiagnostic';
import { deriveView, replay } from './integrationSession';

/**
 * CIT-176: the pre-merge disagreement as one reason-log record, in the same
 * shape lesson 4's other records use (raw / diagnostic / related /
 * evaluationId), so the existing CodeLens and evidence widget render it with
 * no second path. Everything comes from the fixture evaluator via the same
 * session the lesson-6 component drives; `related` carries the comparison as
 * revision-qualified EvidenceLocations (each candidate's contribution
 * relative to base, the combined path, the governing rule, the check).
 */
export const INTEGRATION_LOG_RAW =
  'cit-176-integration scenario: landing candidates A and B together into agent.tasks (synthetic fixture)';

export interface IntegrationLogRecord {
  raw: string;
  resolvedFactId: null;
  lossAxes: string[];
  diagnostic: { severity: 'error'; code: string; message: string; factID: ''; vault: string };
  related: EvidenceLocation[];
  evaluationId: string;
}

export function integrationLogRecord(): IntegrationLogRecord {
  const view = deriveView(replay({ type: 'evaluate' }));
  if (!view.diagnostic) throw new Error('fixture integration must fail its check');
  const { diagnostic, comparison }: { diagnostic: GovernanceDiagnostic; comparison: typeof view.diagnostic.comparison } =
    view.diagnostic;

  const contributions: EvidenceLocation[] = comparison.candidates.flatMap((c) =>
    c.added.map((a) => ({
      role: 'fact' as const,
      uri: FILE_PATH,
      revision: c.revision,
      line: a.line,
      detail: `candidate ${c.id} (env ${c.env}) adds relative to base ${comparison.baseRevision}: ${a.text}`,
    })),
  );
  const check: EvidenceLocation = {
    role: 'axiom',
    uri: CHECK_ID,
    revision: comparison.integrationRevision,
    detail: `${CHECK_ID} over ${revLoc(comparison.integrationRevision, FILE_PATH)}: failed. Candidates A and B each passed alone; a passing check is not human approval`,
  };

  return {
    raw: INTEGRATION_LOG_RAW,
    resolvedFactId: null,
    lossAxes: [],
    diagnostic: {
      severity: 'error',
      code: diagnostic.code,
      message: diagnostic.message,
      factID: '',
      vault: 'cit-176-integration',
    },
    related: [...contributions, ...diagnostic.related, check],
    evaluationId: diagnostic.evaluationId,
  };
}
