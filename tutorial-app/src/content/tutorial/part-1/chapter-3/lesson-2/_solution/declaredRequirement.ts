import type { VaultSpec } from './inventory.pkl';

/**
 * The fix: "claude" is declared under "anthropic.ai", where
 * `observedInventory.ts` shows it actually lives now -- the same move
 * `.dagger/internal/devenv-base/pkl/Vaults.pkl`'s own header comment
 * documents really happened in Proton Pass, with no commit recording it.
 */
export const requirement: VaultSpec = { name: 'anthropic.ai', items: ['claude'] };
