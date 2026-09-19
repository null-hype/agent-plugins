// Vendored from tutorial-app/src/lib/ledgerCheckAccess.ts so this lesson's
// WebContainer sandbox (a self-contained project, no import across the
// _files boundary) can run the exact same evaluator this terminal's own
// reasonResolver.spec.ts (in tutorial-app/src/lib) and reasonResolver.ts
// both use.
import type { Grant } from './grant_state.pkl';

export interface AccessVerdict {
  code: string;
  message: string;
}

/**
 * A TypeScript replay of capability-spike/pkl/Ledger.pkl's checkAccess() --
 * open that file in the editor to the left to read the axiom this mirrors,
 * verbatim, error messages included.
 *
 * `grantsByFactId` is Ledger.pkl's real supervisor state
 * (`GrantState.pkl`'s `Mapping<String, Grant>`, generated to TypeScript as
 * `grant_state.pkl.ts`'s `Grant`), keyed by factID exactly as
 * `GrantState.approvedGrants` is.
 *
 * This function has no access to a Pkl evaluator; it is validated instead
 * by capabilityAcquisition.spec.ts, which checks its passing (null)
 * verdict against the (factID, vault) pair `worker/flight_booking_area51.pkl`
 * records a real `pkl test` pass for, and its CAP_VAULT_MISMATCH verdict
 * against that same factID requested for a different vault, and by
 * capabilityRejection.spec.ts, which checks its CAP_REJECTED verdict
 * against the pair `worker/area51_site4.pkl` records a real `pkl test`
 * failure for.
 */
export function checkAccess(
  factId: string,
  vault: string,
  grantsByFactId: ReadonlyMap<string, Grant>,
): AccessVerdict | null {
  const grant = grantsByFactId.get(factId);
  if (!grant) {
    return { code: 'CAP_NO_GRANT', message: 'no grant has been recorded for this fact -- request pending supervisor review' };
  }
  if (!grant.approved) {
    return { code: 'CAP_REJECTED', message: 'supervisor explicitly rejected this request' };
  }
  if (grant.vault !== vault) {
    return { code: 'CAP_VAULT_MISMATCH', message: `supervisor approved this fact for vault ${grant.vault}, not ${vault}` };
  }
  return null;
}
