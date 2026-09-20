// Vendored from tutorial-app/src/lib/inventoryCheck.ts so this lesson's
// WebContainer sandbox (a self-contained project, no import across the
// _files boundary) can run the exact same code this terminal's own
// `npm test` and the outer app both use.
import type { ObservedInventory, VaultSpec } from './inventory.pkl';

/**
 * A TypeScript replay of capability-spike/pkl/Inventory.pkl's
 * missingItems() -- which of a requirement's declared items are absent
 * from the observed inventory for that vault.
 *
 * This function has no access to a Pkl evaluator; it is validated instead
 * by capabilityAcquisition.spec.ts, which checks it against the exact
 * requirement/observed-inventory values Inventory.test.pkl records real
 * `pkl test` passes for.
 */
export function missingItems(requirement: VaultSpec, observed: ObservedInventory): string[] {
  const observedVault = observed.vaults.find((v) => v.name === requirement.name);
  const have = new Set(observedVault?.items ?? []);
  return requirement.items.filter((item) => !have.has(item));
}
