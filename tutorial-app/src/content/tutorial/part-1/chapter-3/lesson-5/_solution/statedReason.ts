/**
 * The agent's stated reason: the literal string it exports as
 * `PROTON_PASS_AGENT_REASON` before touching a vault, which
 * `runtime.RecordMaterialization` then carries into the observation
 * ledger verbatim.
 *
 * The repair is here and not in `protonObservations.ts`, and not in
 * `pkl/GrantState.pkl`, and not in `pkl/Reconcile.pkl`. The observation
 * is captured evidence -- rewriting its `reason` field would make the
 * check pass by editing the record of what happened. The grant is the
 * supervisor's. The axiom is not wrong: it caught exactly the thing it
 * exists to catch. What was wrong is what the agent said it was doing,
 * and that is the one representation the agent owns.
 */
export const statedReason = 'flight-booking:area51:vault-access';
