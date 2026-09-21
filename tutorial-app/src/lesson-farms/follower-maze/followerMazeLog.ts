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
  /** `lensTitle` is the plain-language CodeLens text the warm log shows instead of the technical code. */
  diagnostic: { severity: 'error' | 'warning'; code: string; message: string; lensTitle?: string } | null;
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

const CELL = 15; // the widest placeholder; keeps a pair on one line of the 600px evidence widget
const MISSING_CELL = '- - missing - -';
const NOT_DUE_CELL = '- - not due - -';

/**
 * Expected against actual, one row per delivery, aligned by (user, seq): a
 * delivery the witness never made sits in the actual column at its expected
 * position as a dashed placeholder, and one it should not have made sits in
 * the expected column as the mirror image. This is text in the evidence
 * widget's own rows, so it adds no rendering surface.
 */
export function pairedRows(world: FollowerMazeWorld, witness: Witness): string[] {
  const same = (a: Delivery, b: Delivery) => a.user === b.user && a.sequence === b.sequence;
  const required = requiredDeliveries(world);
  const rows = required.map((expected) => {
    const actual = witness.deliveries.find((delivery) => same(delivery, expected));
    const state = !actual ? 'missing' : actual.payload === expected.payload ? 'ok' : 'payload differs';
    return { expected: arrow(expected), actual: actual ? arrow(actual) : MISSING_CELL, state };
  });
  for (const extra of witness.deliveries.filter((d) => !required.some((expected) => same(expected, d)))) {
    rows.push({ expected: NOT_DUE_CELL, actual: arrow(extra), state: 'forbidden' });
  }
  return [
    `row  ${'expected'.padEnd(CELL)} | actual`,
    ...rows.map((row, index) => `${index + 1}/${rows.length}  ${row.expected.padEnd(CELL)} | ${row.actual}  [${row.state}]`),
  ];
}

/** `fm-missing-delivery(seq=2,user=10)` as a learner reads it: `missing 10 <- seq 2`. */
function describeFlag(flag: FollowerMazeFlag): string {
  const where = /user=(\d+),seq=(\d+)/.exec(flag.factID);
  const what = flag.kind.replace(/^fm-/, '').replace(/-delivery$/, '');
  return where ? `${what} ${where[1]} <- seq ${where[2]}` : what;
}

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
        detail: `arrival [${arrival}] over connected ${users(world)}: ${wire(world)} (change world: conceptual, the orderings are the question)`,
      },
      ...pairedRows(world, witness).map((detail) => ({ role: 'observation' as const, uri: 'expected|actual', detail })),
      ...flags.map((flag) => ({
        role: 'observation' as const,
        uri: `witness/${model}`,
        detail: `${flagLabel(flag)}: ${flag.detail} (change model: available, switch the witness model and re-evaluate)`,
      })),
      {
        role: 'axiom',
        uri: ORDERED_ROUTING,
        detail: `${ORDERED_ROUTING_RATIONALE} (change axiom: conceptual, not editable in this lesson)`,
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

export type Category = 'pass' | 'missing' | 'forbidden' | 'both' | 'other';

export function outcomeCategory(flags: readonly string[]): Category {
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
  const line = `${rawPrefix}[${arrival}]  ${wire(world)}`;
  if (!evaluated) return plain(line);

  const witness = WITNESS_MODELS[model](world);
  const flags = check(world, witness);
  const evaluationId = `${ORDERED_ROUTING}:arrival-${name}`;
  // Every evaluated row names its outcome in the text itself, so a passing row
  // no longer looks like an unevaluated one and the four outcomes are told apart
  // without opening anything.
  const category = outcomeCategory(flags.map(flagLabel));
  const raw = `${line}  -> ${category}`;
  if (flags.length === 0) return { ...plain(raw), evaluationId };

  const governance = flagsToGovernance(name, world, witness, model, flags);
  return {
    raw,
    diagnostic: {
      severity: 'error',
      code: governance.code,
      message: governance.message,
      lensTitle: `${category === 'both' ? 'both: ' : ''}${flags.map(describeFlag).join(', ')}`,
    },
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
 * model fails), not written as a constant -- and only appears when the model
 * really is fooled by it. It becomes its own line of the log, right under the
 * pass it qualifies, so it reads without hovering anything.
 */
function baselineWarning(model: WitnessModelId): WarmLogRecord | null {
  const outcomes = evaluateFamily(model);
  const passing = outcomes.filter((outcome) => outcome.flags.length === 0);
  if (passing.length === outcomes.length) return null;
  const others = outcomes.length - 1;
  const failing = outcomes.length - passing.length;
  const message = `This ordering passes, but this model fails ${failing} of the other ${others}. Test all ${outcomes.length} orderings.`;
  return {
    ...plain(message),
    diagnostic: {
      severity: 'warning',
      code: 'lesson-baseline-nondiscriminating',
      message,
      lensTitle: `passes here, fails ${failing} of the other ${others}`,
    },
    related: [
      {
        role: 'observation',
        uri: `witness/${model}`,
        detail: `${model} passes ${passing.length} of ${outcomes.length} arrival orderings: ${passing.map((outcome) => outcome.name).join(' ')}`,
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
  records.push(verdict);
  const warning = verdict.diagnostic ? null : baselineWarning(state.witness);
  if (warning) records.push(warning);
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
  /** One entry per arrival ordering once the family is on the board; `category` is null until evaluated. */
  cases: { name: string; category: Category | null }[];
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

  const cases =
    state.arrivals === 'family'
      ? FAMILY.map(({ name }, index) => ({
          name,
          category: records[index].evaluationId === null ? null : outcomeCategory(records[index].flags),
        }))
      : [];

  return {
    records,
    cases,
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
