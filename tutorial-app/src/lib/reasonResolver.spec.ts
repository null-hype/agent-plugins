import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Grant } from './grant_state.pkl';
import { admitted } from './governedVocabulary';
import { FIXTURE_REASON, FIXTURE_REASON_GRANTED, FIXTURE_REASON_UNRESOLVED } from './reasonFixture';
import { CODE_TERM_UNRESOLVED, resolveReason } from './reasonResolver';
import { reasonDiagnosticToGovernance } from './governanceDiagnostic';

/**
 * The mirror image of capability-spike/resolver/resolver_test.go's cases
 * -- same fixtures, same vocabulary, same expected codes. Nothing here
 * reads a live Pkl evaluator; this is what makes that TypeScript replay
 * trustworthy instead of just "not something this lesson lets you fake."
 */
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

/**
 * chapter-3/lesson-4's reason-log.jsonl is a static fixture the
 * otel-warm-log template renders directly (see server.cjs's
 * loadReasonLog/renderReasonLog) -- it is not computed live in the
 * browser. This closes the loop so that committed file can never drift
 * from what resolveReason actually produces for the same inputs: the
 * lesson's Monaco markers/hovers are provably the resolver's real output,
 * not hand-typed prose that happens to look right.
 *
 * CIT-152 widens each record with `related`/`evaluationId` --
 * reasonDiagnosticToGovernance's own output -- so the peek/hover surface
 * server.cjs now renders from those two fields is equally provable, not
 * hand-typed alongside the fields that already were.
 */
describe('chapter-3/lesson-4 reason-log.jsonl matches resolveReason', () => {
  const jsonlPath = fileURLToPath(
    new URL(
      '../content/tutorial/part-1/chapter-3/lesson-4/_files/reason-log.jsonl',
      import.meta.url,
    ),
  );
  const records = readFileSync(jsonlPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const grantsByFactId = new Map<string, Grant>([
    ['pass-cli:color:resume:read-codeword', { factID: 'pass-cli:color:resume:read-codeword', vault: 'jin-91-resume-session', approved: true }],
  ]);

  it('has exactly the three real fixtures, in order: granted, ungranted, unresolved', () => {
    expect(records.map((r) => r.raw)).toEqual([FIXTURE_REASON_GRANTED, FIXTURE_REASON, FIXTURE_REASON_UNRESOLVED]);
  });

  it('every record equals resolveReason(record.raw, ...) exactly, aside from the related/evaluationId CIT-152 adds', () => {
    for (const record of records) {
      const { related, evaluationId, ...resolved } = record;
      expect(resolved).toEqual(resolveReason(record.raw, admitted, grantsByFactId));
    }
  });

  it("every record's related/evaluationId equals reasonDiagnosticToGovernance's own output", () => {
    for (const record of records) {
      const resolved = resolveReason(record.raw, admitted, grantsByFactId);
      const governance = reasonDiagnosticToGovernance(resolved, admitted, grantsByFactId);

      expect(record.related).toEqual(governance?.related ?? []);
      expect(record.evaluationId).toBe(governance?.evaluationId ?? null);
    }
  });
});
