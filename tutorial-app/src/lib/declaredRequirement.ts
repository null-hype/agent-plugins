import type { VaultSpec } from './inventory.pkl';

/**
 * This is the one file a human actually edits in this workflow --
 * `Ledger.pkl`'s own header says a worker "cannot self-grant by editing
 * state, only by asking [checkAccess] a question it doesn't control the
 * answer to," and observed inventory is captured, not typed by hand. A
 * declaration is the one surface that's legitimately yours to correct.
 *
 * This value is correct: "claude" is declared under "anthropic.ai", where
 * `observedInventory.ts` shows it actually lives now. The lesson's
 * `_files/declaredRequirement.ts` starts with the stale, pre-move value
 * instead (vault "tidelands.dev") -- the same drift
 * `.dagger/internal/devenv-base/pkl/Vaults.pkl`'s own header comment
 * documents really happened, with no commit recording it.
 */
export const requirement: VaultSpec = { name: 'anthropic.ai', items: ['claude'] };
