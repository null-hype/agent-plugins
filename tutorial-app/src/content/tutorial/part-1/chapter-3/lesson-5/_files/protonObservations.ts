// Vendored from tutorial-app/src/lib/protonObservations.ts so this lesson's
// WebContainer sandbox (a self-contained project, no import across the
// _files boundary) can run the exact same code this terminal's own
// `npm test` and the outer app both use.
import type { Observation } from './reconcile.pkl';
import { statedReason } from './statedReason';

/**
 * The (factID, vault) pair demo.go approves and materializes, and the
 * two fact IDs its deliberately-misaligned pass uses. Verbatim from
 * capability-spike/demo.go's constant block -- nothing here is invented
 * for the lesson.
 */
export const MAIN_FACT_ID = 'flight-booking:area51:vault-access';
export const MAIN_VAULT = 'thepentagon.com';
export const REJECTED_FACT_ID = 'area51:site4:black-budget-vault-access';
export const REJECTED_VAULT = 'site4.internal';
export const NEVER_APPROVED_FACT_ID = 'shadow-request:roswell:vault-access';

/**
 * demo.go step 7: the real materialization, with its `reason` field left
 * as whatever `statedReason.ts` says. Nobody hand-writes this record in
 * the real workflow -- `runtime.RecordMaterialization` appends it, and
 * it carries the agent's stated reason through unchanged. That
 * pass-through is what makes the reason auditable at all: if the ledger
 * normalized or corrected it on the way in, the check downstream would
 * only ever be checking the ledger against itself.
 *
 * So the repair for a reason mismatch is upstream of this file, in
 * `statedReason.ts`. Editing the record here instead would be editing
 * the evidence to agree with the claim.
 */
export const materialization: Observation = {
  factID: MAIN_FACT_ID,
  vault: MAIN_VAULT,
  reason: statedReason,
};

/**
 * demo.go step 9's first misaligned observation: a Proton operation
 * recorded for a fact the supervisor never approved at all.
 * Frozen by value -- there is no edit that makes this one align, and
 * that is the point of including it.
 */
export const ungrantedMaterialization: Observation = {
  factID: NEVER_APPROVED_FACT_ID,
  vault: 'area51.internal',
  reason: NEVER_APPROVED_FACT_ID,
};

/**
 * demo.go step 9's third: the right reason, against a vault the grant
 * never covered. Also frozen.
 */
export const wrongVaultMaterialization: Observation = {
  factID: MAIN_FACT_ID,
  vault: 'cia.gov',
  reason: MAIN_FACT_ID,
};

/**
 * demo.go step 7 again, but frozen: the reason equal to the fact ID, no
 * matter what `statedReason.ts` currently says. Rows that are about some
 * *other* divergence use this one, so a reader who hasn't fixed the
 * stated reason yet doesn't see every row fail for the same reason and
 * lose the distinction between them.
 */
export const referenceMaterialization: Observation = {
  factID: MAIN_FACT_ID,
  vault: MAIN_VAULT,
  reason: MAIN_FACT_ID,
};

/**
 * demo.go step 9's second misaligned observation, frozen at the value
 * `_files/statedReason.ts` starts from. Kept separate from
 * `materialization` above so the conformance check against the Pkl
 * axiom's golden file has a fixed input, independent of any edit.
 */
export const misattributedMaterialization: Observation = {
  factID: MAIN_FACT_ID,
  vault: MAIN_VAULT,
  reason: REJECTED_FACT_ID,
};
