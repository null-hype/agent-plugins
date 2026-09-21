/**
 * CIT-203 / CIT-202: the Follower Maze `orderedRouting` proposition, as a
 * plain function over a world plus an arbitrary candidate witness -- the same
 * shape as reconcileCheck.ts's `check()`. FollowerMaze.pkl states the same
 * proposition in Pkl; followerMaze.spec.ts runs both over the 24-ordering
 * family and diffs the verdicts, which is what keeps the two from drifting.
 *
 * The corpus rules (bountybench-independent, from the Follower Maze spec):
 * a Follow notifies only the followed user, an Unfollow notifies nobody, a
 * Status Update notifies every current follower of its sender -- and events
 * take effect in *sequence* order, not arrival order. Nothing here holds a
 * canonical solution: `check` derives the obligations from the events and
 * compares them with whatever witness it is handed.
 */

export type EventKind = 'F' | 'U' | 'S';

export interface FollowerMazeEvent {
  sequence: number;
  kind: EventKind;
  fromUser: number;
  toUser: number | null;
  /** The wire form, e.g. `1|F|10|20` -- what a delivery must carry verbatim. */
  payload: string;
}

export interface Delivery {
  user: number;
  sequence: number;
  payload: string;
}

/** `arrivals` is in *arrival* order; `check` derives sequence order itself. */
export interface FollowerMazeWorld {
  connectedUsers: readonly number[];
  arrivals: readonly FollowerMazeEvent[];
}

export interface Witness {
  deliveries: readonly Delivery[];
}

export interface FollowerMazeCase {
  world: FollowerMazeWorld;
  witness: Witness;
}

export interface FollowerMazeFlag {
  kind: string;
  factID: string;
  detail: string;
}

export const FM = {
  missingDelivery: 'fm-missing-delivery',
  forbiddenDelivery: 'fm-forbidden-delivery',
  outOfOrder: 'fm-out-of-order',
  payloadMutated: 'fm-payload-mutated',
} as const;

export const ORDERED_ROUTING = 'followerMaze.orderedRouting';

/**
 * Why an ordering error is reported as a routing error. Carried verbatim into
 * every diagnostic's axiom evidence, because the name says "ordered" while the
 * flag says "missing/forbidden delivery" and the mismatch needs explaining.
 */
export const ORDERED_ROUTING_RATIONALE =
  'ordering errors surface as routing errors because follow-state is temporal: who receives a ' +
  'status update depends on who follows at the moment it is applied, so applying events in ' +
  'arrival order instead of sequence order changes the recipients';

interface RouterState {
  followers: ReadonlyMap<number, ReadonlySet<number>>;
  out: readonly Delivery[];
}

const EMPTY: RouterState = { followers: new Map(), out: [] };

/** The one protocol transition: apply a single event to the routing state. */
function apply(connected: ReadonlySet<number>, state: RouterState, event: FollowerMazeEvent): RouterState {
  const followers = new Map(state.followers);
  const out = [...state.out];
  const followersOf = (user: number) => new Set(followers.get(user) ?? []);

  if (event.kind === 'F' && event.toUser !== null) {
    followers.set(event.toUser, followersOf(event.toUser).add(event.fromUser));
    if (connected.has(event.toUser)) out.push({ user: event.toUser, sequence: event.sequence, payload: event.payload });
  } else if (event.kind === 'U' && event.toUser !== null) {
    const next = followersOf(event.toUser);
    next.delete(event.fromUser);
    followers.set(event.toUser, next);
  } else if (event.kind === 'S') {
    for (const user of [...followersOf(event.fromUser)].sort((a, b) => a - b)) {
      if (connected.has(user)) out.push({ user, sequence: event.sequence, payload: event.payload });
    }
  }
  return { followers, out };
}

/** Per-client trace, ordered by (user, sequence) -- how every witness below is presented. */
const byUserThenSequence = (a: Delivery, b: Delivery) => a.user - b.user || a.sequence - b.sequence;

function route(world: FollowerMazeWorld, events: readonly FollowerMazeEvent[]): Delivery[] {
  const connected = new Set(world.connectedUsers);
  return events.reduce(apply.bind(null, connected), EMPTY).out.slice().sort(byUserThenSequence);
}

/** The obligations entailed by the corpus rules: events applied in sequence order. */
export function requiredDeliveries(world: FollowerMazeWorld): Delivery[] {
  return route(world, [...world.arrivals].sort((a, b) => a.sequence - b.sequence));
}

/**
 * One execution of the message thread: an event went in, these deliveries came
 * out (possibly none, and `held` says why). This is the *observation* channel:
 * what the implementation emitted, in emission order, before any comparison with
 * what the protocol entails.
 */
export interface ThreadStep {
  event: FollowerMazeEvent;
  emitted: Delivery[];
  held?: string;
}

/**
 * Two candidate models a learner's solve() might implement. They are witnesses,
 * not references: `check` never calls either.
 *
 * arrival-order: the plausible wrong model -- handle each event the moment it
 * arrives.
 */
export function arrivalOrderThread(world: FollowerMazeWorld): ThreadStep[] {
  const connected = new Set(world.connectedUsers);
  let state = EMPTY;
  return world.arrivals.map((event) => {
    const before = state.out.length;
    state = apply(connected, state, event);
    return { event, emitted: state.out.slice(before) };
  });
}

/**
 * reorder-buffer: hold an event until every lower sequence has been applied,
 * then release in order. A different algorithm from `requiredDeliveries`'s
 * sort, so passing 24/24 is a real observation and not the reference agreeing
 * with itself.
 */
export function reorderBufferThread(world: FollowerMazeWorld): ThreadStep[] {
  const connected = new Set(world.connectedUsers);
  const pending = new Map<number, FollowerMazeEvent>();
  let state = EMPTY;
  let next = Math.min(...world.arrivals.map((event) => event.sequence));
  return world.arrivals.map((event) => {
    const before = state.out.length;
    pending.set(event.sequence, event);
    for (let ready = pending.get(next); ready; ready = pending.get(next)) {
      state = apply(connected, state, ready);
      pending.delete(next);
      next += 1;
    }
    return {
      event,
      emitted: state.out.slice(before),
      ...(pending.has(event.sequence) ? { held: `held: waiting for seq ${next}` } : {}),
    };
  });
}

const witnessOf = (thread: readonly ThreadStep[]): Witness => ({
  deliveries: thread.flatMap((step) => step.emitted).sort(byUserThenSequence),
});

export const arrivalOrderWitness = (world: FollowerMazeWorld): Witness => witnessOf(arrivalOrderThread(world));
export const reorderBufferWitness = (world: FollowerMazeWorld): Witness => witnessOf(reorderBufferThread(world));

export const THREAD_MODELS = {
  'arrival-order': arrivalOrderThread,
  'reorder-buffer': reorderBufferThread,
} as const;

export const WITNESS_MODELS = {
  'arrival-order': arrivalOrderWitness,
  'reorder-buffer': reorderBufferWitness,
} as const;

export type WitnessModelId = keyof typeof WITNESS_MODELS;

const sameDelivery = (a: Delivery, b: Delivery) => a.user === b.user && a.sequence === b.sequence;
const arrow = (d: Pick<Delivery, 'user' | 'sequence'>) => `${d.user} <- seq ${d.sequence}`;

/** `fm-missing-delivery(seq=2,user=10)` -- the label the issue's table uses. */
export function flagLabel(flag: FollowerMazeFlag): string {
  const match = /^delivery:user=(\d+),seq=(\d+)$/.exec(flag.factID);
  return match ? `${flag.kind}(seq=${match[2]},user=${match[1]})` : flag.kind;
}

const deliveryFact = (d: Pick<Delivery, 'user' | 'sequence'>) => `delivery:user=${d.user},seq=${d.sequence}`;

/**
 * Flags in a fixed order (missing, forbidden, out-of-order, payload-mutated),
 * mirrored by FollowerMaze.pkl's `check`. The witness is compared as a
 * per-client trace: `out-of-order` looks at the order the witness lists a
 * client's deliveries in, so a witness that has already sorted its output (as
 * the two models above do) cannot raise it -- see followerMaze.spec.ts for the
 * hand-built witnesses that do.
 */
export function check(world: FollowerMazeWorld, witness: Witness): FollowerMazeFlag[] {
  const required = requiredDeliveries(world);
  const payloadOf = (sequence: number) => world.arrivals.find((event) => event.sequence === sequence)?.payload ?? '';
  const flags: FollowerMazeFlag[] = [];

  for (const want of required) {
    if (!witness.deliveries.some((got) => sameDelivery(got, want))) {
      flags.push({
        kind: FM.missingDelivery,
        factID: deliveryFact(want),
        detail: `required delivery ${arrow(want)} (${want.payload}) is absent from the witness`,
      });
    }
  }

  for (const got of witness.deliveries) {
    if (!required.some((want) => sameDelivery(got, want))) {
      flags.push({
        kind: FM.forbiddenDelivery,
        factID: deliveryFact(got),
        detail: `witness delivered ${arrow(got)} (${got.payload}), which the protocol does not entail`,
      });
    }
  }

  const lastSeen = new Map<number, number>();
  for (const got of witness.deliveries) {
    const previous = lastSeen.get(got.user);
    if (previous !== undefined && got.sequence < previous) {
      flags.push({
        kind: FM.outOfOrder,
        factID: deliveryFact(got),
        detail: `user ${got.user} received seq ${got.sequence} after seq ${previous}`,
      });
    }
    lastSeen.set(got.user, Math.max(previous ?? got.sequence, got.sequence));
  }

  for (const want of required) {
    const got = witness.deliveries.find((candidate) => sameDelivery(candidate, want));
    if (got && got.payload !== payloadOf(want.sequence)) {
      flags.push({
        kind: FM.payloadMutated,
        factID: deliveryFact(want),
        detail: `${arrow(want)} carried "${got.payload}" but the event payload is "${payloadOf(want.sequence)}"`,
      });
    }
  }

  return flags;
}

/**
 * A stable name for what was handed to the axiom, in the same spirit as
 * toHaveVerdict's reconcile.check branch: name the inputs, don't count them.
 */
export function followerMazeWorldRef({ world, witness }: FollowerMazeCase): string {
  const arrival = world.arrivals.map((event) => event.payload).join(' ');
  const delivered = witness.deliveries.map(arrow).join('|');
  return `connected=[${[...world.connectedUsers].sort((a, b) => a - b).join('|')}] arrival=[${arrival}] witness=[${delivered}]`;
}

/** The registry entry: PASS, or the first flag's kind with every detail in the message. */
export function followerMazeAxiom(_fact: string, { world, witness }: FollowerMazeCase) {
  const flags = check(world, witness);
  return flags.length === 0
    ? { code: 'PASS', message: 'the witness delivers exactly what the sequence-ordered protocol entails' }
    : { code: flags[0].kind, message: flags.map((flag) => `${flagLabel(flag)}: ${flag.detail}`).join('; ') };
}
