import { describe, expect, it } from 'vitest';
import type { Grant } from './grant_state.pkl';
import type { FactFile, Observation } from './reconcile.pkl';
import { admitted } from './governedVocabulary';
import { FIXTURE_REASON, FIXTURE_REASON_GRANTED, FIXTURE_REASON_UNRESOLVED } from './reasonFixture';
import { resolveReason } from './reasonResolver';
import { check, GATE_CALL } from './reconcileCheck';
import { reasonDiagnosticToGovernance, reconcileFlagToGovernance } from './governanceDiagnostic';

/**
 * CIT-152: proves the generalized IR is a faithful widening of CIT-149's
 * resolver output, not a second, competing description of it -- same
 * fixtures reasonResolver.spec.ts already validates, checked here for
 * the `related` evidence a hover/peek would show alongside them.
 */
describe('reasonDiagnosticToGovernance', () => {
  it('a clean resolution has no diagnostic to widen', () => {
    const resolved = resolveReason(FIXTURE_REASON_GRANTED, admitted, new Map([
      ['pass-cli:color:resume:read-codeword', { factID: 'pass-cli:color:resume:read-codeword', vault: 'jin-91-resume-session', approved: true }],
    ]));

    expect(reasonDiagnosticToGovernance(resolved, admitted, new Map())).toBeNull();
  });

  it('CAP_NO_GRANT points at the admitted vocabulary entry and the missing grant', () => {
    const resolved = resolveReason(FIXTURE_REASON, admitted, new Map());
    const governance = reasonDiagnosticToGovernance(resolved, admitted, new Map());

    expect(governance).not.toBeNull();
    expect(governance!.code).toBe('CAP_NO_GRANT');
    expect(governance!.subject).toEqual({ role: 'fact', uri: 'reason-log.jsonl', detail: FIXTURE_REASON });
    expect(governance!.related).toEqual([
      {
        role: 'axiom',
        uri: 'pkl/GovernedVocabulary.pkl',
        detail: '"planting codeword in a fresh session" admitted in scope "jin-91-resume-session" -> factID "pass-cli:color:resume:plant-codeword"',
      },
      {
        role: 'grant',
        uri: 'pkl/GrantState.pkl',
        detail: 'no grant recorded for factID "pass-cli:color:resume:plant-codeword"',
      },
    ]);
    expect(governance!.evaluationId).toBe('ledger.checkAccess:pass-cli:color:resume:plant-codeword');
  });

  it('CAP_VAULT_MISMATCH names the grant it actually found, not just that one was missing', () => {
    const grants = new Map<string, Grant>([
      ['pass-cli:color:resume:plant-codeword', { factID: 'pass-cli:color:resume:plant-codeword', vault: 'some-other-scope', approved: true }],
    ]);
    const resolved = resolveReason(FIXTURE_REASON, admitted, grants);
    const governance = reasonDiagnosticToGovernance(resolved, admitted, grants);

    expect(governance!.code).toBe('CAP_VAULT_MISMATCH');
    expect(governance!.related).toEqual([
      {
        role: 'axiom',
        uri: 'pkl/GovernedVocabulary.pkl',
        detail: '"planting codeword in a fresh session" admitted in scope "jin-91-resume-session" -> factID "pass-cli:color:resume:plant-codeword"',
      },
      {
        role: 'grant',
        uri: 'pkl/GrantState.pkl',
        detail: 'factID "pass-cli:color:resume:plant-codeword" vault "some-other-scope" approved=true',
      },
    ]);
  });

  it('CAP_REJECTED reports the grant it found as explicitly unapproved', () => {
    const grants = new Map<string, Grant>([
      ['pass-cli:color:resume:plant-codeword', { factID: 'pass-cli:color:resume:plant-codeword', vault: 'jin-91-resume-session', approved: false }],
    ]);
    const resolved = resolveReason(FIXTURE_REASON, admitted, grants);
    const governance = reasonDiagnosticToGovernance(resolved, admitted, grants);

    expect(governance!.code).toBe('CAP_REJECTED');
    expect(governance!.related[1]).toEqual({
      role: 'grant',
      uri: 'pkl/GrantState.pkl',
      detail: 'factID "pass-cli:color:resume:plant-codeword" vault "jin-91-resume-session" approved=false',
    });
  });

  it('CAP_TERM_UNRESOLVED points at the vocabulary for that scope, never at a grant nobody could look up', () => {
    const resolved = resolveReason(FIXTURE_REASON_UNRESOLVED, admitted, new Map());
    const governance = reasonDiagnosticToGovernance(resolved, admitted, new Map());

    expect(governance!.code).toBe('CAP_TERM_UNRESOLVED');
    expect(governance!.related).toEqual([
      {
        role: 'axiom',
        uri: 'pkl/GovernedVocabulary.pkl',
        detail: 'no phrases admitted for scope "jin-81-pass-cli"',
      },
    ]);
    expect(governance!.evaluationId).toBe('reasonResolver:jin-81-pass-cli');
  });

  it('an unshaped reason still resolves to a governance diagnostic, never a crash', () => {
    const resolved = resolveReason('not a governed reason string', admitted, new Map());
    const governance = reasonDiagnosticToGovernance(resolved, admitted, new Map());

    expect(governance!.code).toBe('CAP_TERM_UNRESOLVED');
    expect(governance!.related[0].detail).toBe('no phrases admitted for scope ""');
  });
});

/**
 * Same proof for lesson 5's `Flag`s: the world `check()` was actually
 * handed, named back out as `related` evidence, for every flag kind
 * `reconcileCheck.ts` can produce.
 */
describe('reconcileFlagToGovernance', () => {
  const grantsByFactId = new Map<string, Grant>([
    ['flight-booking:area51:vault-access', { factID: 'flight-booking:area51:vault-access', vault: 'thepentagon.com', approved: true }],
  ]);

  it('unapproved-materialization has no grant to point at', () => {
    const observations: Observation[] = [
      { factID: 'shadow-request:roswell:vault-access', vault: 'area51.internal', reason: 'shadow-request:roswell:vault-access' },
    ];
    const [flag] = check(new Map(), observations, []);
    const governance = reconcileFlagToGovernance(flag, { grantsByFactId: new Map(), observations, factFiles: [] });

    expect(governance.code).toBe('unapproved-materialization');
    expect(governance.related).toEqual([
      { role: 'grant', uri: 'pkl/GrantState.pkl', detail: 'no grant recorded for factID "shadow-request:roswell:vault-access"' },
      {
        role: 'observation',
        uri: 'proton-observed.jsonl',
        detail: 'factID "shadow-request:roswell:vault-access" vault "area51.internal" reason "shadow-request:roswell:vault-access"',
      },
    ]);
  });

  it('reason-mismatch (wrong vault) names both the grant it should have matched and what was observed', () => {
    const observations: Observation[] = [
      { factID: 'flight-booking:area51:vault-access', vault: 'cia.gov', reason: 'flight-booking:area51:vault-access' },
    ];
    const flags = check(grantsByFactId, observations, []);
    const governance = reconcileFlagToGovernance(flags[0], { grantsByFactId, observations, factFiles: [] });

    expect(governance.code).toBe('reason-mismatch');
    expect(governance.related).toEqual([
      { role: 'grant', uri: 'pkl/GrantState.pkl', detail: 'factID "flight-booking:area51:vault-access" vault "thepentagon.com" approved=true' },
      {
        role: 'observation',
        uri: 'proton-observed.jsonl',
        detail: 'factID "flight-booking:area51:vault-access" vault "cia.gov" reason "flight-booking:area51:vault-access"',
      },
    ]);
  });

  it('missing-materialization has a grant but no observation to point at', () => {
    const flags = check(grantsByFactId, [], []);
    const governance = reconcileFlagToGovernance(flags[0], { grantsByFactId, observations: [], factFiles: [] });

    expect(governance.code).toBe('missing-materialization');
    expect(governance.related).toEqual([
      { role: 'grant', uri: 'pkl/GrantState.pkl', detail: 'factID "flight-booking:area51:vault-access" vault "thepentagon.com" approved=true' },
    ]);
  });

  it('boundary-bypassed names the fact file itself, and says it never calls the gate', () => {
    const factFiles: FactFile[] = [
      { factID: 'flight-booking:area51:vault-access', path: 'worker/bypassed_gate.pkl', source: 'true' },
    ];
    // Empty grants, so `check()` has no approved-but-unmaterialized grant
    // to also flag -- this isolates the one boundary-bypassed flag the
    // factFiles loop produces.
    const flags = check(new Map(), [], factFiles);
    const flag = flags.find((candidate) => candidate.kind === 'boundary-bypassed');
    const governance = reconcileFlagToGovernance(flag!, { grantsByFactId: new Map(), observations: [], factFiles });

    expect(governance.code).toBe('boundary-bypassed');
    expect(factFiles[0].source).not.toContain(GATE_CALL);
    expect(governance.related).toEqual([
      { role: 'grant', uri: 'pkl/GrantState.pkl', detail: 'no grant recorded for factID "flight-booking:area51:vault-access"' },
      {
        role: 'fact',
        uri: 'worker/bypassed_gate.pkl',
        detail: 'worker/bypassed_gate.pkl never calls Ledger.checkAccess(...)',
      },
    ]);
  });
});
