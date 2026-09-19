import type { Grant } from './grant_state.pkl';
import type { ObservedInventory, VaultSpec } from './inventory.pkl';
import type { FactFile, Observation } from './reconcile.pkl';
import { checkAccess } from './ledgerCheckAccess';
import { missingItems } from './inventoryCheck';
import { check } from './reconcileCheck';

export interface Verdict {
  code: string;
  message: string;
}

export type AxiomId = 'ledger.checkAccess' | 'inventory.missingItems' | 'reconcile.check';

export interface LedgerWorld {
  vault: string;
  grantsByFactId: ReadonlyMap<string, Grant>;
}

export interface InventoryWorld {
  requirement: VaultSpec;
  observed: ObservedInventory;
}

export interface ReconcileWorld {
  grantsByFactId: ReadonlyMap<string, Grant>;
  observations: readonly Observation[];
  factFiles: readonly FactFile[];
}

/**
 * checkAccess/missingItems stay plain functions, validated on their own
 * terms; this registry only normalizes their output to a uniform
 * {code, message} so toHaveVerdict can compare a verdict code without
 * special-casing a thrown-and-caught axiom against a returned-array one.
 */
export const axioms: Record<AxiomId, (fact: string, world: any) => Verdict> = {
  'ledger.checkAccess': (fact, world: LedgerWorld) => {
    const denial = checkAccess(fact, world.vault, world.grantsByFactId);
    return denial ?? { code: 'PASS', message: 'access granted for this fact and vault' };
  },
  'inventory.missingItems': (fact, world: InventoryWorld) => {
    const missing = missingItems(world.requirement, world.observed);
    return missing.length === 0
      ? { code: 'PASS', message: 'all declared items are present in observed inventory' }
      : { code: 'INV_MISSING', message: `missing from vault "${world.requirement.name}": ${missing.join(', ')}` };
  },
  /**
   * Unlike the two above, `reconcile.check` reports on every fact in the
   * world it is handed, not just the one it was asked about -- so this
   * narrows to `fact`'s own flags before reducing to a verdict. A
   * consequence worth stating out loud: PASS here means "nothing
   * diverged for this fact", never "this world is aligned". A caller
   * that wants the second has to ask about every fact in it.
   *
   * Only the first flag becomes the verdict, because a verdict is one
   * code; the rest stay visible in `message`. A fact can diverge in more
   * than one way at once, and collapsing that to a single code is a
   * property of this matcher, not of the axiom.
   */
  'reconcile.check': (fact, world: ReconcileWorld) => {
    const flags = check(world.grantsByFactId, world.observations, world.factFiles).filter(
      (flag) => flag.factID === fact,
    );
    if (flags.length === 0) {
      return { code: 'PASS', message: `fact, grant and observed materialization agree for "${fact}"` };
    }
    return { code: flags[0].kind, message: flags.map((flag) => flag.detail).join('; ') };
  },
};
