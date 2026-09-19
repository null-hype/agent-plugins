// Vendored from tutorial-app/src/lib/toHaveVerdict.ts so this lesson's
// WebContainer sandbox (a self-contained project, no import across the
// _files boundary) can run the exact same code this terminal's own
// `npm test` and the outer app both use.
import { appendFileSync } from 'node:fs';
import { expect } from 'vitest';
import { axioms, type AxiomId } from './axioms';

function worldRef(axiomId: AxiomId, world: any): string {
  switch (axiomId) {
    case 'ledger.checkAccess':
      return `vault=${world.vault} grants=${world.grantsByFactId.size}`;
    case 'inventory.missingItems':
      return `vault=${world.requirement.name} observedVaults=${world.observed.vaults.length}`;
    case 'reconcile.check': {
      // No single vault to name: reconcile.check's world spans every
      // grant, observation and fact file at once. A count is not a
      // reference -- many different worlds share the same
      // grants=2 observations=1 factFiles=1 shape -- so name what was
      // actually handed to the axiom instead of how much of it.
      const grantRef = [...world.grantsByFactId.keys()].sort().join('|');
      const observationRef = world.observations
        .map((o: { factID: string; vault: string }) => `${o.factID}@${o.vault}`)
        .sort()
        .join('|');
      const factFileRef = world.factFiles.map((f: { path: string }) => f.path).sort().join('|');
      return `grants=[${grantRef}] observations=[${observationRef}] factFiles=[${factFileRef}]`;
    }
  }
}

/**
 * Appends unconditionally, on pass and fail alike, so a green run still
 * leaves evaluations.jsonl for a lesson compiler to read later -- the
 * whole reason this matcher records instead of just asserting.
 */
function recordEvaluation(record: { axiomId: AxiomId; factId: string; world: string; verdict: string }): void {
  appendFileSync('evaluations.jsonl', `${JSON.stringify(record)}\n`);
}

expect.extend({
  toHaveVerdict(factId: string, axiomId: AxiomId, world: unknown, expectedCode: string) {
    const verdict = axioms[axiomId](factId, world);
    const pass = verdict.code === expectedCode;

    recordEvaluation({ axiomId, factId, world: worldRef(axiomId, world), verdict: verdict.code });

    return {
      pass,
      actual: verdict.code,
      expected: expectedCode,
      message: () =>
        `axiom "${axiomId}" returned ${verdict.code}${verdict.message ? ` (${verdict.message})` : ''} for fact "${factId}", expected ${expectedCode}`,
    };
  },
});

declare module 'vitest' {
  interface Matchers<R, T = unknown> {
    toHaveVerdict(axiomId: AxiomId, world: unknown, expectedCode: string): R;
  }
}
