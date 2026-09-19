import type { Grant } from './grant_state.pkl';
import type { FactFile, Flag, Observation } from './reconcile.pkl';

/**
 * The four divergences `reconcile.Check` reports, as the verbatim
 * `FlagKind` strings capability-spike/reconcile/reconcile.go declares and
 * capability-spike/pkl/Reconcile.pkl re-declares as constants. Kept as a
 * const object rather than retyped inline so a drift between the three
 * shows up as a failing comparison, not as a string nobody reads.
 */
export const FLAG = {
  unapprovedMaterialization: 'unapproved-materialization',
  missingMaterialization: 'missing-materialization',
  reasonMismatch: 'reason-mismatch',
  boundaryBypassed: 'boundary-bypassed',
} as const;

/**
 * The one substring that separates a fact that asked the supervisor a
 * question from a fact that answered it itself. The trailing `(` is
 * load-bearing: `bypassed_gate.pkl`'s own doc comment mentions
 * `Ledger.checkAccess` in prose, and a check that matched the bare name
 * would read that comment as a gate call.
 */
export const GATE_CALL = 'Ledger.checkAccess(';

/**
 * A TypeScript replay of capability-spike/reconcile/reconcile.go's
 * `Check`, and of the `check()` in capability-spike/pkl/Reconcile.pkl
 * that states the same invariant in Pkl -- open either to read the axiom
 * this mirrors, detail strings included.
 *
 * Same three inputs and same order of work as the Go: observations
 * first, then approved grants nothing materialized, then the structural
 * boundary check over the fact files' own text. The Go reads its grants
 * from `pkl/GrantState.pkl` via the real pkl-go bindings, its
 * observations from `build/proton-observed.jsonl`, and each fact file
 * from disk; this takes all three as arguments because the browser has
 * no Pkl evaluator and no such files -- the same limitation
 * ledgerCheckAccess.ts and inventoryCheck.ts already document.
 *
 * What it is NOT is a second opinion about whether a test passed. Every
 * value it reads was produced by something that already reported
 * success: the worker fact's `pkl test` run, the supervisor's recorded
 * decision, the runtime's materialization. It is the check that asks
 * whether those three successes describe the same world.
 */
export function check(
  grantsByFactId: ReadonlyMap<string, Grant>,
  observations: readonly Observation[],
  factFiles: readonly FactFile[],
): Flag[] {
  const flags: Flag[] = [];
  const materialized = new Set<string>();

  for (const observation of observations) {
    materialized.add(observation.factID);
    const grant = grantsByFactId.get(observation.factID);

    if (!grant || !grant.approved) {
      flags.push({
        kind: FLAG.unapprovedMaterialization,
        factID: observation.factID,
        detail: 'Proton observation recorded with no matching approved grant',
      });
      // Nothing coherent left to compare this observation's reason or
      // vault against, so it is reported once and not checked further --
      // same `continue` the Go takes.
      continue;
    }

    // `reason` is what PROTON_PASS_AGENT_REASON actually carried at
    // materialization time -- the field that can drift in a real
    // integration. `factID` is metadata the recorder chose, so checking
    // it alone would validate nothing; the reason itself must equal the
    // stable fact ID it is filed under.
    if (observation.reason !== observation.factID) {
      flags.push({
        kind: FLAG.reasonMismatch,
        factID: observation.factID,
        detail: `PROTON_PASS_AGENT_REASON "${observation.reason}" does not match the governing fact ID "${observation.factID}"`,
      });
    }

    if (observation.vault !== grant.vault) {
      flags.push({
        kind: FLAG.reasonMismatch,
        factID: observation.factID,
        detail: `observed vault "${observation.vault}" does not match the governing grant's vault "${grant.vault}"`,
      });
    }
  }

  for (const grant of grantsByFactId.values()) {
    if (!grant.approved) continue;
    if (materialized.has(grant.factID)) continue;
    flags.push({
      kind: FLAG.missingMaterialization,
      factID: grant.factID,
      detail: 'grant approved but no Proton materialization was ever observed',
    });
  }

  for (const factFile of factFiles) {
    if (factFile.source.includes(GATE_CALL)) continue;
    flags.push({
      kind: FLAG.boundaryBypassed,
      factID: factFile.factID,
      detail: `${factFile.path} does not call Ledger.checkAccess -- any green result did not go through the supervisor boundary`,
    });
  }

  return flags;
}
