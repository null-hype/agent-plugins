// Vendored from tutorial-app/src/lib/frameCheck.spec.ts so this lesson's
// WebContainer sandbox (a self-contained project, no import across the
// _files boundary) can run the exact same code this terminal's own
// `npm test` and the outer app both use.
import { describe, expect, it } from 'vitest';
import './toHaveVerdict';
import type { Grant } from './grant_state.pkl';
import type { FactFile } from './reconcile.pkl';
import {
  MAIN_FACT_ID,
  MAIN_VAULT,
  NEVER_APPROVED_FACT_ID,
  REJECTED_FACT_ID,
  REJECTED_VAULT,
  materialization,
  misattributedMaterialization,
  referenceMaterialization,
  ungrantedMaterialization,
  wrongVaultMaterialization,
} from './protonObservations';
import { GATE_CALL, check } from './reconcileCheck';
import { RECONCILE_GOLDEN_DIAGNOSTICS } from './reconcileGolden';
import { readWorkerFactSource } from './workerFactSource';

/**
 * CIT-150. Four representations of one capability acquisition, and the
 * question of what to do when they disagree:
 *
 *   fact        what the worker asked for  (worker/*.pkl)
 *   model       what the agent says it is doing  (statedReason.ts)
 *   grant       what the supervisor decided  (pkl/GrantState.pkl)
 *   observation what actually materialized  (the Proton ledger)
 *
 * `pkl/Reconcile.pkl`'s `check()` is the axiom over those four, and
 * `reconcileCheck.ts` is its TypeScript replay. Neither is a second
 * opinion about whether a test passed: every value below was produced by
 * something that already reported success.
 *
 * Two rows start red and are repaired by editing exactly one file each,
 * and which file it is, is the whole exercise. Four more start green and
 * stay green -- they assert a *diagnostic*, not a PASS, because a
 * divergence correctly reported is a correct outcome. Making those four
 * report PASS would take editing the axiom, and the axiom is not wrong.
 */

/**
 * The state demo.go step 3 writes through a real `supervisor.Decide`
 * call: one approval, one explicit rejection. Frozen -- nothing in this
 * lesson lets a reader write a grant, which is the point of the
 * ownership boundary `Ledger.pkl`'s own header describes.
 */
const grantsByFactId = new Map<string, Grant>([
  [MAIN_FACT_ID, { factID: MAIN_FACT_ID, vault: MAIN_VAULT, approved: true }],
  [REJECTED_FACT_ID, { factID: REJECTED_FACT_ID, vault: REJECTED_VAULT, approved: false }],
]);

/**
 * The fact file whose `pkl test` run is green and whose frame is wrong.
 * Read off disk at check time, exactly as `factRoutesThroughGate` reads
 * it, so editing the file is what changes this verdict.
 */
const bypassedFact: FactFile = {
  factID: MAIN_FACT_ID,
  path: 'worker/bypassed_gate.pkl',
  source: readWorkerFactSource('worker/bypassed_gate.pkl'),
};

/**
 * The control. `pkl test` reports success for this file and for
 * `bypassed_gate.pkl` alike; the results are indistinguishable. The only
 * thing that separates them is whether the assertion routed through the
 * supervisor, which is a property of the source, not of the result.
 */
const governedFact: FactFile = {
  factID: MAIN_FACT_ID,
  path: 'worker/flight_booking_area51.pkl',
  source: readWorkerFactSource('worker/flight_booking_area51.pkl'),
};

const noFactFiles: readonly FactFile[] = [];

describe('the instrument agrees with the axiom it replays', () => {
  /**
   * The conformance check: same world as `Reconcile.test.pkl`'s
   * `examples {}` block, same rendering as demo.go's transcript line, so
   * a drift between the Pkl axiom and this replay fails here rather than
   * quietly teaching the wrong thing.
   *
   * Its inputs are frozen, the bypassed fact included -- deliberately.
   * The exercise below edits that file, and a conformance check whose
   * result depends on how far a reader has got is not a conformance
   * check. The gate-free source is derived from the governed fact rather
   * than read off disk, so it stays gate-free whatever either file
   * currently says, and it carries capability-spike's own path because
   * that is the path the golden file names.
   */
  const neverAskedSource = governedFact.source.replace(
    'Ledger.checkAccess(factID, requestedVault)',
    'true',
  );

  const frozenBypassedFact: FactFile = {
    factID: MAIN_FACT_ID,
    path: 'worker/fixtures_invalid/bypassed_gate.pkl',
    source: neverAskedSource,
  };

  it('derives a genuinely gate-free source to check against', () => {
    expect(governedFact.source).toContain(GATE_CALL);
    expect(neverAskedSource).not.toContain(GATE_CALL);
  });

  it('reproduces Reconcile.test.pkl-expected.pcf exactly, in order', () => {
    const rendered = check(
      grantsByFactId,
      [ungrantedMaterialization, misattributedMaterialization, wrongVaultMaterialization],
      [frozenBypassedFact, governedFact],
    ).map((flag) => `${flag.kind} fact=${flag.factID}: ${flag.detail}`);

    expect(rendered).toEqual([...RECONCILE_GOLDEN_DIAGNOSTICS]);
  });
});

describe('a green test is evidence about the test', () => {
  it.each([
    {
      name: 'the supervisor approved this fact for this vault -- the gate itself has nothing to report',
      axiomId: 'ledger.checkAccess' as const,
      factId: MAIN_FACT_ID,
      world: { vault: MAIN_VAULT, grantsByFactId },
      expectedCode: 'PASS',
    },
    {
      name: 'the stated reason must name the fact it is governed by -- fix statedReason.ts',
      axiomId: 'reconcile.check' as const,
      factId: MAIN_FACT_ID,
      world: { grantsByFactId, observations: [materialization], factFiles: [governedFact] },
      expectedCode: 'PASS',
    },
    {
      name: 'a fact that never asks the supervisor is flagged however green its test is -- fix worker/bypassed_gate.pkl',
      axiomId: 'reconcile.check' as const,
      factId: MAIN_FACT_ID,
      world: { grantsByFactId, observations: [referenceMaterialization], factFiles: [bypassedFact] },
      expectedCode: 'PASS',
    },
    {
      name: 'the governed fact file, whose pkl test result is identical, is not flagged',
      axiomId: 'reconcile.check' as const,
      factId: MAIN_FACT_ID,
      world: { grantsByFactId, observations: [referenceMaterialization], factFiles: [governedFact] },
      expectedCode: 'PASS',
    },
    {
      name: 'a materialization with no approved grant behind it stays reported -- there is no edit that aligns it',
      axiomId: 'reconcile.check' as const,
      factId: NEVER_APPROVED_FACT_ID,
      world: { grantsByFactId, observations: [ungrantedMaterialization], factFiles: noFactFiles },
      expectedCode: 'unapproved-materialization',
    },
    {
      name: 'the right reason against a vault the grant never covered stays reported',
      axiomId: 'reconcile.check' as const,
      factId: MAIN_FACT_ID,
      world: { grantsByFactId, observations: [wrongVaultMaterialization], factFiles: noFactFiles },
      expectedCode: 'reason-mismatch',
    },
    {
      name: 'an approved grant nobody materialized stays reported -- approval is not use',
      axiomId: 'reconcile.check' as const,
      factId: MAIN_FACT_ID,
      world: { grantsByFactId, observations: [], factFiles: noFactFiles },
      expectedCode: 'missing-materialization',
    },
  ])('$name', ({ axiomId, factId, world, expectedCode }) => {
    expect(factId).toHaveVerdict(axiomId, world, expectedCode);
  });
});
