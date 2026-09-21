import { useState } from 'react';

// Throwaway demo component for CIT-235: three observable states (a squiggle,
// no squiggle, a ▶) that a Playwright @tutorial test drives step by step.
// `reasonState`/`decisionState` are Storybook args -- each exported story in
// Area51Booking.stories.tsx fixes them to one lesson step's *starting*
// state; the Playwright test is the only thing that ever changes them at
// runtime (no play function here, see the stories file).

export type ReasonState = 'invalid' | 'valid';
export type DecisionState = 'untyped' | 'typed';

export interface Area51BookingProps {
  reasonState: ReasonState;
  decisionState: DecisionState;
}

export const VALID_REASON = 'Scheduled facility inspection, badge #A51-7';
const TYPED_DECISION = "'approve' | 'deny'";

// Same squiggle stroke GrammarLsp.tsx uses, so this reads as the same IDE
// vocabulary as the rest of the tutorial rather than a one-off mockup.
const SQUIGGLE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='3'%3E%3Cpath d='M0 2c.7 0 1.3-.7 2-1.3C2.7.1 3.3 0 4 0c.7 0 1.3.1 2 .7' fill='none' stroke='%23ef4444' stroke-width='1'/%3E%3C/svg%3E") repeat-x bottom`;

export default function Area51Booking({ reasonState, decisionState }: Area51BookingProps) {
  const [reason, setReason] = useState(reasonState === 'valid' ? VALID_REASON : '');
  const [decisionTyped, setDecisionTyped] = useState(decisionState === 'typed');
  const [confirmed, setConfirmed] = useState(false);

  const reasonValid = reason.trim().length >= 10;
  // `runnable` means the two checks upstream pass -- it is NOT "allowed".
  // The next storyboard frame adds a monitor that can still reject a runnable
  // booking, so don't let this (or the CONFIRMED text below) harden into
  // "runnable implies permitted".
  const runnable = reasonValid && decisionTyped;

  return (
    <div
      style={{
        fontFamily: 'ui-monospace, monospace',
        width: 480,
        padding: 24,
        background: '#0f172a',
        color: '#e2e8f0',
        borderRadius: 8,
      }}
    >
      <h2 style={{ marginTop: 0, fontSize: 16 }}>area51 booking</h2>

      <label htmlFor="reason-input" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
        reason.txt
      </label>
      <textarea
        id="reason-input"
        data-testid="reason-input"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: reasonValid ? '#1e293b' : SQUIGGLE + ', #1e293b',
          color: '#e2e8f0',
          border: '1px solid #334155',
          padding: 8,
          fontFamily: 'inherit',
          fontSize: 13,
        }}
      />
      {!reasonValid && (
        <p role="alert" style={{ color: '#ef4444', fontSize: 11, margin: '4px 0 0' }}>
          reason does not compile: needs at least 10 characters
        </p>
      )}

      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12 }}>decision.ts</span>
        <code data-testid="decision-code" style={{ fontSize: 12 }}>
          let decision: {decisionTyped ? TYPED_DECISION : 'any'};
        </code>
        <span
          data-testid="decision-badge"
          style={{
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 4,
            background: decisionTyped ? '#166534' : '#7f1d1d',
            color: decisionTyped ? '#bbf7d0' : '#fecaca',
          }}
        >
          {decisionTyped ? 'typed' : 'untyped'}
        </span>
        {!decisionTyped && (
          <button
            type="button"
            data-testid="type-decision-button"
            onClick={() => setDecisionTyped(true)}
            style={{ fontSize: 11, padding: '4px 8px' }}
          >
            add type annotation
          </button>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        {runnable ? (
          <button type="button" data-testid="run-button" onClick={() => setConfirmed(true)} style={{ fontSize: 13, padding: '6px 12px' }}>
            ▶ run booking
          </button>
        ) : (
          <span data-testid="run-blocked" style={{ fontSize: 11, color: '#64748b' }}>
            ▶ run booking (blocked)
          </span>
        )}
        {confirmed && (
          <p data-testid="confirmation" style={{ color: '#22c55e', fontSize: 12, marginTop: 8 }}>
            CONFIRMED: area51 booking
          </p>
        )}
      </div>
    </div>
  );
}
