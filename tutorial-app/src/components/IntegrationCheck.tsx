import React, { useId, useReducer, useState } from 'react';
import './IntegrationCheck.css';
import { FILE_PATH, REPAIR, revLoc } from '../lib/integrationScenario';
import { INITIAL_STATE, deriveView, reduce, type SessionState } from '../lib/integrationSession';

/**
 * CIT-176: the shared pre-merge comparison. Rendered by Storybook and by the
 * tutorial lesson. Every verdict shown here comes from deriveView(), i.e.
 * from running the fixture evaluator; nothing is passed in as a display
 * verdict. FIXTURE ONLY: revisions and environments are simulated.
 */
interface Props {
  initialState?: SessionState;
  initialInspect?: boolean;
}

const STATUS_LABEL = {
  pending: 'Not yet evaluated',
  failed: 'Failed',
  passed: 'Passed',
  stale: 'Stale: inputs changed',
  conflict: 'Textual conflict',
} as const;

function Badge({ kind, children }: { kind: string; children: React.ReactNode }) {
  return <span className={`ic-badge ic-${kind}`}>{children}</span>;
}

export default function IntegrationCheck({ initialState = INITIAL_STATE, initialInspect = false }: Props) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [inspecting, setInspecting] = useState(initialInspect);
  const panelId = useId();
  const view = deriveView(state);
  const { integration } = view;
  const short = (r: string) => r;

  return (
    <section className="ic" aria-label="Pre-merge integration check">
      <p className="ic-note">
        Synthetic fixture: revisions and environment names are simulated. Nothing here lands anything.
      </p>

      <ul className="ic-cards">
        {view.candidates.map(({ candidate, check }) => (
          <li className="ic-card" key={candidate.id}>
            <h3>Candidate {candidate.id}: {candidate.title}</h3>
            <p>{candidate.summary}</p>
            <p className="ic-meta">env {candidate.env}<br />rev <code>{short(candidate.revision)}</code></p>
            <p>Check <code>{check.checkId}</code>: <Badge kind={check.outcome}>{check.outcome === 'pass' ? 'Passed' : 'Failed'}</Badge></p>
          </li>
        ))}
        <li className="ic-card" aria-live="polite">
          <h3>Proposed integration</h3>
          <p className="ic-meta">base <code>{view.base.revision}</code> + A + B<br />rev <code>{integration.revision}</code></p>
          <p>Check: <Badge kind={view.status}>{STATUS_LABEL[view.status]}</Badge></p>
          <p>
            Human approval:{' '}
            <Badge kind={`appr-${view.approval}`}>
              {view.approval === 'none' ? 'Not approved' : view.approval === 'granted' ? 'Approved (simulated)' : 'Approval stale'}
            </Badge>
          </p>
          {view.staleApproval && (
            <p className="ic-warn">Prior approval was for <code>{view.staleApproval.integrationRevision}</code>, not this revision.</p>
          )}
          {view.status === 'stale' && view.recorded && (
            <p className="ic-warn">Last evaluation was for <code>{view.recorded.integrationRevision}</code> ({view.recorded.evaluation.outcome}); it does not describe this revision.</p>
          )}
        </li>
      </ul>

      {(view.status === 'pending' || view.status === 'stale') && (
        <button type="button" className="ic-primary" onClick={() => dispatch({ type: 'evaluate' })}>
          {view.status === 'stale' ? 'Re-evaluate integration' : 'Evaluate integration'}
        </button>
      )}

      {view.diagnostic && (
        <div className="ic-diag" role="alert">
          <p><strong>{view.diagnostic.diagnostic.code}</strong>: {view.diagnostic.diagnostic.message}.</p>
          <p>Each candidate passed alone; the combination breaks rule <code>{view.diagnostic.comparison.rule.text}</code>.</p>
          <button
            type="button"
            className="ic-primary"
            aria-expanded={inspecting}
            aria-controls={panelId}
            onClick={() => setInspecting((v) => !v)}
          >
            Inspect disagreement
          </button>
        </div>
      )}

      {view.diagnostic && inspecting && (
        <div id={panelId} className="ic-panel">
          <h4>Contributions relative to base <code>{view.diagnostic.comparison.baseRevision}</code></h4>
          {view.diagnostic.comparison.candidates.map((c) => (
            <div key={c.id}>
              <p className="ic-meta">Candidate {c.id} (<code>{c.revision}</code>) adds:</p>
              {c.added.map((a) => (
                <pre key={a.line} className="ic-add">{`+ ${revLoc(c.revision, FILE_PATH, a.line)}\n+ ${a.text}`}</pre>
              ))}
            </div>
          ))}
          <h4>Combined path in the integration <code>{view.diagnostic.comparison.integrationRevision}</code></h4>
          <ol className="ic-path">
            {view.diagnostic.comparison.path.map((s, i) => (
              <li key={i}>
                <Badge kind={`origin-${s.origin}`}>{s.origin}</Badge> {s.task} {s.action}{' '}
                <code>{revLoc(integration.revision, FILE_PATH, s.line)}</code>
              </li>
            ))}
          </ol>
          <h4>Governing rule</h4>
          <p><code>{view.diagnostic.comparison.rule.text}</code> at <code>{revLoc(integration.revision, FILE_PATH, view.diagnostic.comparison.rule.line)}</code></p>
          <h4>Check</h4>
          <p>
            <code>{view.recorded?.evaluation.checkId}</code> over <code>{integration.revision}</code>: <Badge kind="failed">Failed</Badge>{' '}
            (evaluation <code>{view.diagnostic.diagnostic.evaluationId}</code>). Same path <code>{FILE_PATH}</code> holds different
            content in base, A, B and the integration; each location above names its revision.
          </p>
          {!state.repairApplied && (
            <div className="ic-repair">
              <h4>Proposed repair</h4>
              <p><strong>{REPAIR.title}.</strong> {REPAIR.description}</p>
              <pre className="ic-add">{`- ${REPAIR.from.text.split('\n').find((l) => l.startsWith('task sync-report'))}\n+ ${REPAIR.to.text.split('\n').find((l) => l.startsWith('task sync-report'))}`}</pre>
              <button type="button" className="ic-primary" onClick={() => dispatch({ type: 'applyRepair' })}>
                Apply repair (revises candidate B)
              </button>
            </div>
          )}
        </div>
      )}

      {view.status === 'passed' && (
        <div className="ic-ok">
          <p>
            <strong>Checks passed for <code>{integration.revision}</code>.</strong> A passing check is evidence, not authorization:
            landing still needs a human decision bound to this exact revision.
          </p>
          {view.approval !== 'granted' ? (
            <button type="button" className="ic-primary" onClick={() => dispatch({ type: 'approve' })}>
              Approve landing (simulated)
            </button>
          ) : (
            <p><Badge kind="appr-granted">Approved (simulated)</Badge> for <code>{integration.revision}</code>. Nothing was landed.</p>
          )}
        </div>
      )}

      <button type="button" className="ic-link" onClick={() => { dispatch({ type: 'reset' }); setInspecting(false); }}>
        Reset scenario
      </button>
    </section>
  );
}
