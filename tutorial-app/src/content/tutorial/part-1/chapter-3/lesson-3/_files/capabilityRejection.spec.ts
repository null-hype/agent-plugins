// Vendored from tutorial-app/src/lib/capabilityRejection.spec.ts -- this is
// the exact spec `npm test` below runs, in this exact WebContainer, against
// the exact pkl/Ledger.pkl, pkl/Inventory.pkl and worker/area51_site4.pkl
// files in the tree to the left.
import { describe, expect, it } from 'vitest';
import './toHaveVerdict';
import type { Grant } from './grant_state.pkl';
import type { ObservedInventory, VaultSpec } from './inventory.pkl';

/**
 * The mirror image of capabilityAcquisition.spec.ts's scenario: same two
 * axioms, but the supervisor's answer is no, and nothing here is yours to
 * fix -- so every row's world is frozen by value, not read from a file a
 * Solve action could rewrite. There is no _solution for this lesson.
 *
 * Every literal value below is copied from a real committed Pkl fixture:
 * `fact`/`vault` and the rejected grant are worker/area51_site4.pkl and
 * GrantState.pkl's `area51:site4:black-budget-vault-access` entry
 * (`pkl test worker/area51_site4.pkl` really fails with CAP_REJECTED,
 * against a grant captured from a real `supervisor.Decide` call); the
 * requirement is the same VaultSpec shape Inventory.test.pkl validates
 * missingItems() against.
 */
const fact = 'area51:site4:black-budget-vault-access';
const vault = 'site4.internal';
const requirement: VaultSpec = { name: vault, items: ['black-budget-vault-access'] };
const notYetObserved: ObservedInventory = { vaults: [{ name: vault, items: [] }] };

const noGrantsByFactId = new Map<string, Grant>();
const rejectedGrantsByFactId = new Map<string, Grant>([[fact, { factID: fact, vault, approved: false }]]);

describe('when the supervisor says no', () => {
  it('a task declares what it needs, using Inventory.pkl\'s VaultSpec shape', () => {
    expect(requirement).toEqual({ name: 'site4.internal', items: ['black-budget-vault-access'] });
  });

  it.each([
    {
      name: 'nothing has been requested yet -- denied with a specific diagnostic, same as before any request',
      axiomId: 'ledger.checkAccess' as const,
      factId: fact,
      world: { vault, grantsByFactId: noGrantsByFactId },
      expectedCode: 'CAP_NO_GRANT',
    },
    {
      name: 'the item is absent from the inventory observed so far',
      axiomId: 'inventory.missingItems' as const,
      factId: 'inventory:black-budget-vault-access',
      world: { requirement, observed: notYetObserved },
      expectedCode: 'INV_MISSING',
    },
    {
      name: 'requesting the capability gets a real supervisor decision -- rejected, permanently, not pending',
      axiomId: 'ledger.checkAccess' as const,
      factId: fact,
      world: { vault, grantsByFactId: rejectedGrantsByFactId },
      expectedCode: 'CAP_REJECTED',
    },
    {
      name: 'refreshing observed state after a rejection changes nothing -- there was never a grant to materialize',
      axiomId: 'inventory.missingItems' as const,
      factId: 'inventory:black-budget-vault-access',
      world: { requirement, observed: notYetObserved },
      expectedCode: 'INV_MISSING',
    },
  ])('$name', ({ axiomId, factId, world, expectedCode }) => {
    expect(factId).toHaveVerdict(axiomId, world, expectedCode);
  });
});
