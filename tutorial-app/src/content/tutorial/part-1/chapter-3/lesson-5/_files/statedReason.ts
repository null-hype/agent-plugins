// Vendored from tutorial-app/src/lib/statedReason.ts so this lesson's
// WebContainer sandbox (a self-contained project, no import across the
// _files boundary) can run the exact same code this terminal's own
// `npm test` and the outer app both use.
/**
 * The agent's stated reason: the literal string it exports as
 * `PROTON_PASS_AGENT_REASON` before touching a vault, which
 * `runtime.RecordMaterialization` then carries into the observation
 * ledger verbatim (capability-spike/runtime/proton.go's `Observation.
 * Reason` -- "the literal PROTON_PASS_AGENT_REASON value").
 *
 * This is the one file this lesson asks a reader to edit, and the reason
 * it's the right one is the same reason `declaredRequirement.ts` is the
 * editable surface in lesson 2: it is the agent's own declaration about
 * itself. The grant is the supervisor's to write, the observation is
 * captured rather than authored, and the fact file's job is to ask a
 * question it doesn't control the answer to. What the agent *says it is
 * doing* is the only one of the four that is legitimately its own.
 *
 * This value is wrong, and it is worth being precise about how. It is a
 * real fact ID. It is recorded in `pkl/GrantState.pkl` right now. It has
 * the shape a reader would check for, so every validation you could run
 * on the string by itself passes. It is demo.go step 9's second
 * deliberately-misaligned observation, and it is simply not this
 * operation's fact.
 *
 * That is why no amount of checking the reason *in isolation* catches
 * it, and why `Reconcile.pkl` checks it against the fact it claims to be
 * governed by instead. Per CIT-139: prefer a stable fact ID over literal
 * string matching -- and then check that the stable ID is the right one.
 *
 * The operation this actually describes is
 * `flight-booking:area51:vault-access`, in vault `thepentagon.com` (see
 * `protonObservations.ts`).
 */
export const statedReason = 'area51:site4:black-budget-vault-access';
