// Vendored from tutorial-app/src/lib/reconcileGolden.ts so this lesson's
// WebContainer sandbox (a self-contained project, no import across the
// _files boundary) can run the exact same code this terminal's own
// `npm test` and the outer app both use.
/**
 * Copied verbatim from
 * capability-spike/pkl/Reconcile.test.pkl-expected.pcf -- the golden file
 * `pkl test` writes and then re-reads for that module's `examples {}`
 * block, rendered through demo.go's own `flagged: %s fact=%s: %s`
 * transcript format.
 *
 * This is what makes reconcileCheck.ts's TypeScript replay checkable
 * rather than merely plausible. The browser cannot reach a Pkl
 * evaluator, so nothing in this lesson runs the real axiom; what
 * frameCheck.spec.ts can do is assert that the replay, given the same
 * world, produces these exact strings in this exact order. A replay that
 * drifts from the axiom it replays stops being evidence about the axiom.
 *
 * Regenerate by running `pkl test pkl/Reconcile.test.pkl` in
 * capability-spike/ and re-copying the rendered list.
 */
export const RECONCILE_GOLDEN_DIAGNOSTICS: readonly string[] = [
  'unapproved-materialization fact=shadow-request:roswell:vault-access: Proton observation recorded with no matching approved grant',
  'reason-mismatch fact=flight-booking:area51:vault-access: PROTON_PASS_AGENT_REASON "area51:site4:black-budget-vault-access" does not match the governing fact ID "flight-booking:area51:vault-access"',
  'reason-mismatch fact=flight-booking:area51:vault-access: observed vault "cia.gov" does not match the governing grant\'s vault "thepentagon.com"',
  'boundary-bypassed fact=flight-booking:area51:vault-access: worker/fixtures_invalid/bypassed_gate.pkl does not call Ledger.checkAccess -- any green result did not go through the supervisor boundary',
];
