// Vendored from tutorial-app/src/lib/capabilityAcquisition.spec.ts -- this
// is the exact spec `npm test` below runs, in this exact WebContainer,
// against the exact pkl/Ledger.pkl, pkl/Inventory.pkl and
// worker/flight_booking_area51.pkl files in the tree to the left.
import { describe, expect, it } from 'vitest';
import './toHaveVerdict';
import { requirement } from './declaredRequirement';
import { observed, observedVaultNames } from './observedInventory';
import type { Grant } from './grant_state.pkl';
import grantState from './grantState.json';

/**
 * Two real, separate axioms govern whether a task can get what it needs:
 * pkl/Inventory.pkl's missingItems() (declared vs. observed inventory) and
 * pkl/Ledger.pkl's checkAccess() (supervisor approval). They fail for
 * different reasons, and only one of those reasons is yours to fix.
 *
 * `declaredRequirement.ts` is the one file this scenario asks you to edit.
 * `grantState.json` is the other: it starts empty and is rewritten by
 * Solve-as-supervisor, not by hand -- see pkl/GrantState.pkl, which
 * starts empty for the same reason: the world shown and the world tested
 * must agree.
 *
 * Every literal value below is copied from a real committed Pkl fixture,
 * not invented for this test: the drift scenario is Inventory.test.pkl's
 * `staleDeclaration`/`correctedDeclaration`/`driftObserved`
 * (`pkl test pkl/Inventory.test.pkl` really passes both facts);
 * `observedVaultNames` is Vaults.test.pkl-expected.pcf's own golden
 * snapshot, copied verbatim; the approved grant is
 * worker/flight_booking_area51.pkl and GrantState.pkl's
 * `flight-booking:area51:vault-access` entry, a real captured
 * `supervisor.Decide` result (`capability-spike/supervisor/state.go`).
 */
const liveGrantsByFactId = new Map<string, Grant>(Object.entries(grantState.approvedGrants));

/**
 * Frozen by value, not read from grantState.json: this row demonstrates
 * what happens when the *same* approved grant is checked against a
 * different vault, so it must keep passing whether or not Solve has run.
 */
const frozenApprovedGrantsByFactId = new Map<string, Grant>([
  [
    'flight-booking:area51:vault-access',
    { factID: 'flight-booking:area51:vault-access', vault: 'thepentagon.com', approved: true },
  ],
]);

describe('acquiring the flight-booking:area51:vault-access capability', () => {
  it.each([
    {
      name: 'a stale declaration is a bug you can fix yourself',
      axiomId: 'inventory.missingItems' as const,
      factId: 'inventory:claude',
      world: { requirement, observed },
      expectedCode: 'PASS',
    },
    {
      name: 'only a real supervisor decision clears CAP_NO_GRANT -- not something this lesson lets you fake',
      axiomId: 'ledger.checkAccess' as const,
      factId: 'flight-booking:area51:vault-access',
      world: { vault: 'thepentagon.com', grantsByFactId: liveGrantsByFactId },
      expectedCode: 'PASS',
    },
    {
      name: 'an approval for one vault does not carry over to another',
      axiomId: 'ledger.checkAccess' as const,
      factId: 'flight-booking:area51:vault-access',
      world: { vault: 'site4.internal', grantsByFactId: frozenApprovedGrantsByFactId },
      expectedCode: 'CAP_VAULT_MISMATCH',
    },
  ])('$name', ({ axiomId, factId, world, expectedCode }) => {
    expect(factId).toHaveVerdict(axiomId, world, expectedCode);
  });

  it('observed state carries more than any one declaration accounts for -- that is expected, not a bug', () => {
    // "api.linear.app" has no VaultSpec in Vaults.pkl at all. Per that
    // file's own header: "This is a decision, not a transcription of
    // `pass-cli vault list` output." This is the examples{}/.pkl-expected.pcf
    // golden-snapshot step's TypeScript equivalent -- a value you accept
    // by committing it, not a pass/fail assertion you make hold.
    expect(observedVaultNames).toMatchInlineSnapshot(`
      [
        "anthropic.ai",
        "api.linear.app",
        "infra",
        "jingling057",
        "test",
        "tidelands.dev",
      ]
    `);
  });
});
