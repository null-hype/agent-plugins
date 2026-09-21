/**
 * CIT-203: what the Follower Maze lesson hands the existing warm-log renderer.
 *
 * The warm log (templates/otel-warm-log/server.cjs) is a generic
 * JSON-Lines-with-diagnostics renderer: it takes `{raw, diagnostic?, related?}`
 * per line and draws the squiggle, hover, CodeLens and evidence widget. This
 * module only produces those records -- it renders nothing. The diagnostic is
 * therefore the editor's own marker, not a card that depicts one.
 *
 * Nothing in here knows the storyboard exists: `LessonState` is what a learner
 * does (solve, evaluate, transform), and every board frame is whatever
 * `boardFor` returns for the state those actions reach.
 */
import type { EvidenceLocation, GovernanceDiagnostic } from '../../lib/governanceDiagnostic';
import worldJson from './fixtures/world.json';
import {
  ORDERED_ROUTING,
  ORDERED_ROUTING_RATIONALE,
  WITNESS_MODELS,
  check,
  flagLabel,
  followerMazeAxiom,
  requiredDeliveries,
  type Delivery,
  type FollowerMazeEvent,
  type FollowerMazeFlag,
  type FollowerMazeWorld,
  type Witness,
  type WitnessModelId,
} from './followerMaze';

// -- worlds: the base world plus one arrival fixture per ordering -------------

const eventsBySequence = new Map<number, FollowerMazeEvent>(
  (worldJson.events as FollowerMazeEvent[]).map((event) => [event.sequence, event]),
);

export const worldFor = (arrival: readonly number[]): FollowerMazeWorld => ({
  connectedUsers: worldJson.connectedUsers,
  arrivals: arrival.map((sequence) => eventsBySequence.get(sequence)!),
});

const arrivalFixtures = import.meta.glob<{ arrival: number[] }>('./fixtures/arrivals/*.json', {
  eager: true,
  import: 'default',
});

/** Every arrival ordering fixture, keyed by its file stem (`4231`), in lexicographic order. */
export const FAMILY: readonly { name: string; arrival: number[] }[] = Object.entries(arrivalFixtures)
  .map(([path, fixture]) => ({ name: /([^/]+)\.json$/.exec(path)![1], arrival: fixture.arrival }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const BASELINE = [1, 2, 3, 4] as const;
const BASELINE_NAME = BASELINE.join('');

// -- records ------------------------------------------------------------------

export interface WarmLogRecord {
  raw: string;
  diagnostic: { severity: 'error' | 'warning'; code: string; message: string } | null;
  related: EvidenceLocation[];
  evaluationId: string | null;
  axiomId: string;
  /** `fm-missing-delivery(seq=2,user=10)` labels, for the board's counter. */
  flags: string[];
}

const arrow = (d: Pick<Delivery, 'user' | 'sequence'>) => `${d.user} <- seq ${d.sequence}`;
const users = (world: FollowerMazeWorld) => `{${[...world.connectedUsers].sort((a, b) => a - b).join(', ')}}`;
const wire = (world: FollowerMazeWorld) => world.arrivals.map((event) => event.payload).join(' ');

const plain = (raw: string): WarmLogRecord => ({
  raw,
  diagnostic: null,
  related: [],
  evaluationId: null,
  axiomId: ORDERED_ROUTING,
  flags: [],
});

/**
 * The diagnostic for a failing world, in the IR CIT-152 defined. The three
 * evidence roles are exactly the three things a repair can change -- the
 * arrival world (`fact`), the candidate's deliveries (`observation`), the
 * proposition (`axiom`) -- so the repair row needs no slot of its own: each
 * entry names the repair it stands for.
 */
export function flagsToGovernance(
  name: string,
  world: FollowerMazeWorld,
  witness: Witness,
  model: WitnessModelId,
  flags: readonly FollowerMazeFlag[],
): GovernanceDiagnostic {
  const verdict = followerMazeAxiom(name, { world, witness });
  const arrival = world.arrivals.map((event) => event.sequence).join(',');
  const evaluationId = `${ORDERED_ROUTING}:arrival-${name}`;
  return {
    code: verdict.code,
    severity: 'error',
    message: verdict.message,
    subject: { role: 'fact', uri: `fixtures/arrivals/${name}.json`, detail: `arrival [${arrival}]` },
    related: [
      {
        role: 'fact',
        uri: `fixtures/arrivals/${name}.json`,
        detail: `arrival [${arrival}] over connected ${users(world)}: ${wire(world)} (change world)`,
      },
      ...flags.map((flag) => ({
        role: 'observation' as const,
        uri: `witness/${model}`,
        detail: `${flagLabel(flag)}: ${flag.detail} (change model)`,
      })),
      {
        role: 'axiom',
        uri: ORDERED_ROUTING,
        detail: `${ORDERED_ROUTING_RATIONALE} (change axiom)`,
      },
    ],
    evaluationId,
  };
}

export interface FamilyOutcome {
  name: string;
  flags: FollowerMazeFlag[];
}

/** Run one witness model over every arrival ordering. */
export function evaluateFamily(model: WitnessModelId): FamilyOutcome[] {
  return FAMILY.map(({ name, arrival }) => {
    const world = worldFor(arrival);
    return { name, flags: check(world, WITNESS_MODELS[model](world)) };
  });
}

export function outcomeCategory(flags: readonly string[]): 'pass' | 'missing' | 'forbidden' | 'both' | 'other' {
  const has = (code: string) => flags.some((flag) => flag.startsWith(code));
  if (flags.length === 0) return 'pass';
  const missing = has('fm-missing-delivery');
  const forbidden = has('fm-forbidden-delivery');
  const others = flags.some((flag) => !flag.startsWith('fm-missing-delivery') && !flag.startsWith('fm-forbidden-delivery'));
  if (others) return 'other';
  return missing && forbidden ? 'both' : missing ? 'missing' : 'forbidden';
}

function caseRecord(
  name: string,
  world: FollowerMazeWorld,
  model: WitnessModelId,
  evaluated: boolean,
  rawPrefix = '',
): WarmLogRecord {
  const arrival = world.arrivals.map((event) => event.sequence).join(',');
  const raw = `${rawPrefix}[${arrival}]  ${wire(world)}`;
  if (!evaluated) return plain(raw);

  const witness = WITNESS_MODELS[model](world);
  const flags = check(world, witness);
  const evaluationId = `${ORDERED_ROUTING}:arrival-${name}`;
  if (flags.length === 0) return { ...plain(raw), evaluationId };

  const governance = flagsToGovernance(name, world, witness, model, flags);
  return {
    raw,
    diagnostic: { severity: 'error', code: governance.code, message: governance.message },
    related: governance.related,
    evaluationId,
    axiomId: ORDERED_ROUTING,
    flags: flags.map(flagLabel),
  };
}

/** The 24-line permutation log: one record per arrival ordering. */
export function familyRecords(model: WitnessModelId, evaluated = true): WarmLogRecord[] {
  return FAMILY.map(({ name, arrival }) => caseRecord(name, worldFor(arrival), model, evaluated));
}

export const toJsonl = (records: readonly WarmLogRecord[]): string =>
  records.map((record) => JSON.stringify(record)).join('\n') + '\n';

// -- the lesson: what a learner does, and the board that results ---------------

export interface LessonState {
  witness: WitnessModelId | null;
  arrivals: 'baseline' | 'family';
  evaluated: boolean;
}

export type LessonAction =
  | { type: 'solve'; model: WitnessModelId }
  | { type: 'evaluate' }
  | { type: 'transform' };

export const initialLessonState: LessonState = { witness: null, arrivals: 'baseline', evaluated: false };

export function reduceLesson(state: LessonState, action: LessonAction): LessonState {
  switch (action.type) {
    case 'solve':
      return { ...state, witness: action.model, evaluated: false };
    case 'evaluate':
      // Nothing to evaluate until solve() has produced a witness.
      return state.witness ? { ...state, evaluated: true } : state;
    case 'transform':
      // The same four events under every arrival order: a new world, so any
      // earlier verdict no longer applies.
      return { ...state, arrivals: 'family', evaluated: false };
  }
}

/**
 * Passing the baseline says little when the wrong model passes it too. The
 * warning is derived from the family (how many orderings the *same* witness
 * model passes), not written as a constant -- and only appears when the model
 * really is fooled by it.
 */
function baselineWarning(
  model: WitnessModelId,
): { severity: 'warning'; code: string; message: string; related: EvidenceLocation[] } | null {
  const outcomes = evaluateFamily(model);
  const passing = outcomes.filter((outcome) => outcome.flags.length === 0);
  if (passing.length === outcomes.length) return null;
  const share = `${passing.length} of ${outcomes.length}`;
  return {
    severity: 'warning',
    code: 'lesson-baseline-nondiscriminating',
    message: `green here rules out nothing: the ${model} model also passes ${share} orderings of these four events`,
    related: [
      {
        role: 'observation',
        uri: `witness/${model}`,
        detail: `${model} passes ${share} arrival orderings: ${passing.map((outcome) => outcome.name).join(' ')}`,
      },
      { role: 'axiom', uri: ORDERED_ROUTING, detail: ORDERED_ROUTING_RATIONALE },
    ],
  };
}

function baselineRecords(state: LessonState): WarmLogRecord[] {
  const world = worldFor(BASELINE);
  const records = [
    plain(`world connected ${users(world)}`),
    plain(`arrival [${BASELINE.join(',')}]  ${wire(world)}`),
    ...requiredDeliveries(world).map((delivery) => plain(`required ${arrow(delivery)}`)),
  ];

  if (!state.witness) return [...records, plain('witness awaiting solve()')];

  records.push(...WITNESS_MODELS[state.witness](world).deliveries.map((delivery) => plain(`witness ${arrow(delivery)}`)));
  if (!state.evaluated) return records;

  const verdict = caseRecord(BASELINE_NAME, world, state.witness, true, 'evaluate ');
  const warning = verdict.diagnostic ? null : baselineWarning(state.witness);
  if (warning) {
    const { related, ...diagnostic } = warning;
    records.push({ ...verdict, raw: `${verdict.raw}  PASS`, diagnostic, related });
  } else {
    records.push({ ...verdict, raw: verdict.diagnostic ? verdict.raw : `${verdict.raw}  PASS` });
  }
  return records;
}

export interface Tally {
  evaluated: number;
  pass: number;
  missing: number;
  forbidden: number;
  both: number;
  other: number;
}

export interface Board {
  records: WarmLogRecord[];
  /** Distinct axioms the log's evaluations cite. More than one means the transfer failed. */
  axiomIds: string[];
  /** Arrival orderings (worlds) the proposition is currently applied across. */
  worlds: number;
  tally: Tally;
}

export function boardFor(state: LessonState): Board {
  const records =
    state.arrivals === 'family' && state.witness
      ? familyRecords(state.witness, state.evaluated)
      : state.arrivals === 'family'
        ? familyRecords('arrival-order', false)
        : baselineRecords(state);

  const tally: Tally = { evaluated: 0, pass: 0, missing: 0, forbidden: 0, both: 0, other: 0 };
  for (const record of records) {
    if (record.evaluationId === null) continue;
    tally.evaluated += 1;
    tally[outcomeCategory(record.flags)] += 1;
  }

  return {
    records,
    axiomIds: [...new Set(records.map((record) => record.axiomId))],
    worlds: state.arrivals === 'family' ? FAMILY.length : 1,
    tally,
  };
}

export const counterText = ({ evaluated, pass, missing, forbidden, both, other }: Tally): string =>
  evaluated === 0
    ? 'not evaluated'
    : `${pass} pass · ${missing} missing · ${forbidden} forbidden · ${both} both${other ? ` · ${other} other` : ''}`;

export const badgeText = ({ axiomIds, worlds }: Board): string =>
  axiomIds.length === 1
    ? `${axiomIds[0]} · ${worlds} ${worlds === 1 ? 'world' : 'worlds'}`
    : `${axiomIds.length} axioms: ${axiomIds.join(', ')} — the transfer failed`;
