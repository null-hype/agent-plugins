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
 * This value is correct: it is the stable fact ID of the operation it
 * actually describes, per CIT-139's "prefer a stable fact ID over
 * literal string matching" -- the same value demo.go step 7 records
 * (`Reason: mainFactID // PROTON_PASS_AGENT_REASON=<fact_id>`).
 *
 * The lesson's `_files/statedReason.ts` starts from
 * `area51:site4:black-budget-vault-access` instead: demo.go step 9's
 * second deliberately-misaligned observation, and a far more interesting
 * wrong answer than prose would be. It is a real fact ID. It is recorded
 * in this very grant state. It matches the shape a reader would check
 * for. It is simply not this operation's fact -- which is why no amount
 * of validating the reason *in isolation* can catch it, and why the
 * check has to be against the fact it claims to be governed by.
 */
export const statedReason = 'flight-booking:area51:vault-access';
