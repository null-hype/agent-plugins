import type { VaultSpec } from './inventory.pkl';

/**
 * EDIT ME. This declaration says "claude" lives in vault "tidelands.dev" --
 * that used to be true, but it isn't anymore (see `observedInventory.ts`,
 * which is read-only: nobody hand-edits real observed state).
 *
 * `Ledger.pkl`'s own header says a worker "cannot self-grant by editing
 * state, only by asking [checkAccess] a question it doesn't control the
 * answer to" -- but a declaration is different. It's yours. When it's
 * wrong, you fix it yourself; nobody needs to approve that.
 *
 * Run `npm test` in the terminal below. The first test fails. Fix the
 * `name` field so it matches where "claude" actually lives now, save, and
 * run `npm test` again. Stuck? The help button below the file tree applies
 * the real fix.
 */
export const requirement: VaultSpec = { name: 'tidelands.dev', items: ['claude'] };
