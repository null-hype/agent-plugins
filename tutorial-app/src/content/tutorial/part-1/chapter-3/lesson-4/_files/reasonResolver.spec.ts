// Vendored from tutorial-app/src/lib/reasonResolver.spec.ts -- this is the
// exact spec that validates reasonResolver.ts and reason-log.jsonl (the log
// the preview to the right renders), minus the file that reads
// reason-log.jsonl from outside this lesson's own _files boundary: that
// half runs for real in tutorial-app's own `npm test`, not in this
// WebContainer.
import { describe, expect, it } from 'vitest';
import type { Grant } from './grant_state.pkl';
import { admitted } from './governedVocabulary';
import { FIXTURE_REASON, FIXTURE_REASON_GRANTED, FIXTURE_REASON_UNRESOLVED } from './reasonFixture';
import { CODE_TERM_UNRESOLVED, resolveReason } from './reasonResolver';

describe('reason resolver (CIT-149)', () => {
  it('an admitted phrase with no recorded grant reports CAP_NO_GRANT, not a boolean', () => {
    const result = resolveReason(FIXTURE_REASON, admitted, new Map());

    expect(result.raw).toBe(FIXTURE_REASON);
    expect(result.resolvedFactId).toBe('pass-cli:color:resume:plant-codeword');
    expect(result.lossAxes.length).toBeGreaterThan(0);
    expect(result.diagnostic).not.toBeNull();
    expect(result.diagnostic).toMatchObject({ severity: 'error', code: 'CAP_NO_GRANT' });
    expect(result.diagnostic!.message.length).toBeGreaterThan(0);
  });

  it('an unadmitted phrase reports CAP_TERM_UNRESOLVED -- a different code from admitted-but-ungranted', () => {
    const grantsWithUnrelatedEntry = new Map<string, Grant>([
      ['pass-cli:color:resume:plant-codeword', { factID: 'pass-cli:color:resume:plant-codeword', vault: 'jin-91-resume-session', approved: true }],
    ]);

    const result = resolveReason(FIXTURE_REASON_UNRESOLVED, admitted, grantsWithUnrelatedEntry);

    expect(result.raw).toBe(FIXTURE_REASON_UNRESOLVED);
    expect(result.resolvedFactId).toBeNull();
    expect(result.diagnostic?.code).toBe(CODE_TERM_UNRESOLVED);
    expect(result.diagnostic?.code).not.toBe('CAP_NO_GRANT');
  });

  it('an admitted phrase with an approved matching grant resolves clean', () => {
    const grants = new Map<string, Grant>([
      ['pass-cli:color:resume:read-codeword', { factID: 'pass-cli:color:resume:read-codeword', vault: 'jin-91-resume-session', approved: true }],
    ]);

    const result = resolveReason(FIXTURE_REASON_GRANTED, admitted, grants);

    expect(result.diagnostic).toBeNull();
    expect(result.resolvedFactId).toBe('pass-cli:color:resume:read-codeword');
  });

  it('a grant approved for a different scope than the reason carries never resolves clean', () => {
    const grants = new Map<string, Grant>([
      ['pass-cli:color:resume:plant-codeword', { factID: 'pass-cli:color:resume:plant-codeword', vault: 'some-other-scope', approved: true }],
    ]);

    const result = resolveReason(FIXTURE_REASON, admitted, grants);

    expect(result.diagnostic).not.toBeNull();
    expect(result.diagnostic?.code).toBe('CAP_VAULT_MISMATCH');
  });

  it('an explicitly rejected grant reports CAP_REJECTED', () => {
    const grants = new Map<string, Grant>([
      ['pass-cli:color:resume:plant-codeword', { factID: 'pass-cli:color:resume:plant-codeword', vault: 'jin-91-resume-session', approved: false }],
    ]);

    const result = resolveReason(FIXTURE_REASON, admitted, grants);

    expect(result.diagnostic?.code).toBe('CAP_REJECTED');
  });

  it('a reason not shaped like "<scope> scenario: <phrase>" is unresolved, not a crash', () => {
    const result = resolveReason('not a governed reason string', admitted, new Map());

    expect(result.raw).toBe('not a governed reason string');
    expect(result.resolvedFactId).toBeNull();
    expect(result.diagnostic?.code).toBe(CODE_TERM_UNRESOLVED);
  });
});
