// Vendored from tutorial-app/src/lib/toHaveVerdict.ts so this lesson's
// WebContainer sandbox (a self-contained project, no import across the
// _files boundary) can run the exact same matcher this terminal's own
// `npm test` and the outer app both use.
import { appendFileSync } from 'node:fs';
import { expect } from 'vitest';
import { axioms, type AxiomId } from './axioms';

function worldRef(axiomId: AxiomId, world: any): string {
  return axiomId === 'ledger.checkAccess'
    ? `vault=${world.vault} grants=${world.grantsByFactId.size}`
    : `vault=${world.requirement.name} observedVaults=${world.observed.vaults.length}`;
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
