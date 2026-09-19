import type { AdmittedTerm } from './governedVocabulary.pkl';
import type { Grant } from './grant_state.pkl';
import type { FactFile, Flag, Observation } from './reconcile.pkl';
import { GATE_CALL } from './reconcileCheck';
import type { ResolvedReason } from './reasonResolver';

/**
 * CIT-152: the four kinds of evidence a governance diagnostic can point
 * at, named the same way CIT-150's own back-and-forth already used them
 * (see chapter-3/lesson-5's "Facts, axioms, examples, evaluations"):
 * world state (`fact`, `grant`, `observation`) and the relationship
 * asserted over it (`axiom`).
 */
export type EvidenceRole = 'fact' | 'grant' | 'observation' | 'axiom';

/**
 * One piece of evidence a diagnostic's verdict rests on. `uri` names
 * where it lives (a real path in the tree to the left, or the log the
 * diagnostic itself came from); `detail` is the rendered value at that
 * location -- a hover or a peek has to show *something*, and this
 * project's own axioms (checkAccess, reconcile.check) have no live Pkl
 * evaluator to read a fresh value from, so `detail` is always a value
 * some other real function already computed, never invented for
 * display.
 */
export interface EvidenceLocation {
  role: EvidenceRole;
  uri: string;
  detail: string;
}

/**
 * The generalized shape CIT-149's narrower `{severity, code, message,
 * factID, vault}` Diagnostic and lesson 5's `Flag {kind, factID, detail}`
 * are both specializations of -- the IR CIT-152 asks to define so an
 * editor (or anything else) is "just a renderer for it": a verdict
 * (`code`/`severity`/`message`) about one `subject`, plus the `related`
 * representations that verdict was computed from, plus `evaluationId`, a
 * stable name for which axiom-over-which-world produced it (never a
 * count of inputs -- see toHaveVerdict.ts's own `worldRef` for why
 * counts collide across unrelated worlds).
 */
export interface GovernanceDiagnostic {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  subject: EvidenceLocation;
  related: EvidenceLocation[];
  evaluationId: string;
}

const GOVERNED_VOCABULARY_URI = 'pkl/GovernedVocabulary.pkl';
const GRANT_STATE_URI = 'pkl/GrantState.pkl';
const RECONCILE_URI = 'pkl/Reconcile.pkl';
const PROTON_OBSERVED_URI = 'proton-observed.jsonl';

function grantDetail(factID: string, grant: Grant | undefined): string {
  return grant
    ? `factID "${grant.factID}" vault "${grant.vault}" approved=${grant.approved}`
    : `no grant recorded for factID "${factID}"`;
}

/**
 * Lesson 4's reasonResolver.ts already produces a `Diagnostic` for every
 * code it can return; this only adds the `related` evidence a hover or
 * peek needs to show *why*, reading the same `admitted`/`grantsByFactId`
 * inputs resolveReason itself took -- it does not re-derive anything
 * resolveReason didn't already establish. Returns `null` exactly when
 * `resolved.diagnostic` is `null` (the reason resolved clean, nothing to
 * show a marker for).
 */
export function reasonDiagnosticToGovernance(
  resolved: ResolvedReason,
  admitted: readonly AdmittedTerm[],
  grantsByFactId: ReadonlyMap<string, Grant>,
): GovernanceDiagnostic | null {
  const diagnostic = resolved.diagnostic;

  if (!diagnostic) {
    return null;
  }

  const subject: EvidenceLocation = {
    role: 'fact',
    uri: 'reason-log.jsonl',
    detail: resolved.raw,
  };

  if (diagnostic.code === 'CAP_TERM_UNRESOLVED') {
    const admittedForScope = admitted.filter((term) => term.scope === diagnostic.vault);

    return {
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      subject,
      related: [
        {
          role: 'axiom',
          uri: GOVERNED_VOCABULARY_URI,
          detail:
            admittedForScope.length > 0
              ? `admitted phrases for scope "${diagnostic.vault}": ${admittedForScope.map((term) => term.phrase).join('; ')}`
              : `no phrases admitted for scope "${diagnostic.vault}"`,
        },
      ],
      evaluationId: `reasonResolver:${diagnostic.vault}`,
    };
  }

  const entry = admitted.find((term) => term.factId === diagnostic.factID);
  const grant = grantsByFactId.get(diagnostic.factID);

  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    subject,
    related: [
      {
        role: 'axiom',
        uri: GOVERNED_VOCABULARY_URI,
        detail: entry
          ? `"${entry.phrase}" admitted in scope "${entry.scope}" -> factID "${entry.factId}"`
          : `factID "${diagnostic.factID}" has no admitted vocabulary entry`,
      },
      {
        role: 'grant',
        uri: GRANT_STATE_URI,
        detail: grantDetail(diagnostic.factID, grant),
      },
    ],
    evaluationId: `ledger.checkAccess:${diagnostic.factID}`,
  };
}

/**
 * Lesson 5's reconcileCheck.ts already produces a `Flag` for every
 * divergence `check()` finds; this widens it to the shared IR by naming
 * the actual grant, observation and fact file `check()` was handed for
 * that `factID` -- the exact "competing representations" CIT-151's own
 * discussion (quoted in this issue) said the diagnostic should expose,
 * not just the fact that they disagreed.
 */
export function reconcileFlagToGovernance(
  flag: Flag,
  world: {
    grantsByFactId: ReadonlyMap<string, Grant>;
    observations: readonly Observation[];
    factFiles: readonly FactFile[];
  },
): GovernanceDiagnostic {
  const grant = world.grantsByFactId.get(flag.factID);
  const observation = world.observations.find((candidate) => candidate.factID === flag.factID);
  const factFile = world.factFiles.find((candidate) => candidate.factID === flag.factID);

  const related: EvidenceLocation[] = [
    {
      role: 'grant',
      uri: GRANT_STATE_URI,
      detail: grantDetail(flag.factID, grant),
    },
  ];

  if (observation) {
    related.push({
      role: 'observation',
      uri: PROTON_OBSERVED_URI,
      detail: `factID "${observation.factID}" vault "${observation.vault}" reason "${observation.reason}"`,
    });
  }

  if (factFile) {
    related.push({
      role: 'fact',
      uri: factFile.path,
      detail: factFile.source.includes(GATE_CALL)
        ? `${factFile.path} calls Ledger.checkAccess(...)`
        : `${factFile.path} never calls Ledger.checkAccess(...)`,
    });
  }

  return {
    code: flag.kind,
    severity: 'error',
    message: flag.detail,
    subject: {
      role: 'axiom',
      uri: RECONCILE_URI,
      detail: `reconcile.check flagged factID "${flag.factID}": ${flag.kind}`,
    },
    related,
    evaluationId: `reconcile.check:${flag.factID}`,
  };
}
