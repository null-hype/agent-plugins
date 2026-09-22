#!/usr/bin/env node
// CIT-246: the agent side of a real, minimal ACP exchange -- loosely modeled
// on agentclientprotocol/typescript-sdk's own src/examples/agent.ts, trimmed
// to exactly the one prompt/response turn this lesson's fixture needs (no
// tool calls, no permission requests -- CIT-245 explicitly scoped this
// lesson to a minimal request/diagnostic exchange only).
//
// `newSession` returns a fixed sessionId (a real agent would randomize it)
// so that re-running this capture is byte-for-byte reproducible, which is
// the property that makes it useful as a committed fixture rather than a
// one-time transcript nobody can check.
//
// CIT-247: the diagnostic below is no longer hand-typed. It is `_meta` shaped
// as a real `GovernanceDiagnostic` (src/lib/governanceDiagnostic.ts), computed
// by running the vendored, dependency-free `followerMaze.ts` (see that file's
// own header) over one real arrival ordering (`arrival-4231.json`, arrival
// order 4,2,3,1) with the "plausible wrong model" witness
// (`arrivalOrderWitness`: apply each event the instant it arrives, instead of
// in sequence order). That witness really does drop a required delivery for
// this ordering -- verified live via `node --experimental-strip-types` before
// this file was written, not asserted from memory:
//
//   required deliveries (sequence order): 20 <- seq 1, 10 <- seq 2
//   arrival-order witness delivers only:  20 <- seq 1
//   check() flags: fm-missing-delivery(seq=2,user=10)
//
// The glue that shapes those flags into a GovernanceDiagnostic (`subject`,
// `related`, `evaluationId`) is a duplicate of followerMazeLog.ts's own
// `flagsToGovernance`/`pairedRows`, minus that lesson's own UI hint text
// ("change world: conceptual", etc.) which doesn't apply to this replay --
// duplicated rather than imported because followerMazeLog.ts's top-level
// `import.meta.glob` calls make it unimportable outside Vite.
import * as acp from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ORDERED_ROUTING,
  ORDERED_ROUTING_RATIONALE,
  arrivalOrderWitness,
  check,
  followerMazeAxiom,
  reorderBufferWitness,
  requiredDeliveries,
  unconstrained,
} from './followerMaze.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const worldJson = JSON.parse(readFileSync(join(__dirname, 'world.json'), 'utf8'));
const arrivalJson = JSON.parse(readFileSync(join(__dirname, 'arrival-4231.json'), 'utf8'));
const ARRIVAL_NAME = '4231';

const eventsBySequence = new Map(worldJson.events.map((event) => [event.sequence, event]));
const world = {
  connectedUsers: worldJson.connectedUsers,
  arrivals: arrivalJson.arrival.map((sequence) => eventsBySequence.get(sequence)),
};

const arrow = (d) => `${d.user} <- seq ${d.sequence}`;
const sameDelivery = (a, b) => a.user === b.user && a.sequence === b.sequence;

/** Duplicate of followerMazeLog.ts's `pairedRows`, without its lesson-specific UI hints. */
function pairedRows(caseWorld, witness) {
  const required = requiredDeliveries(caseWorld);
  const rows = required.map((expected) => {
    const actual = witness.deliveries.find((candidate) => sameDelivery(candidate, expected));
    const state = !actual ? 'missing' : actual.payload === expected.payload ? 'ok' : 'payload differs';
    return { expected: arrow(expected), actual: actual ? arrow(actual) : '-- missing --', state };
  });
  const open = unconstrained(caseWorld);
  for (const extra of witness.deliveries.filter(
    (delivery) => !required.some((expected) => sameDelivery(expected, delivery)) && !open.has(delivery.sequence),
  )) {
    rows.push({ expected: '-- not due --', actual: arrow(extra), state: 'forbidden' });
  }
  return rows;
}

/** Duplicate of followerMazeLog.ts's `flagsToGovernance`, shaping real `check()` flags. */
function flagsToGovernance(name, caseWorld, witness, model) {
  const verdict = followerMazeAxiom(name, { world: caseWorld, witness });
  const arrival = caseWorld.arrivals.map((event) => event.sequence).join(',');
  const wire = caseWorld.arrivals.map((event) => event.payload).join(' ');
  const users = [...caseWorld.connectedUsers].sort((a, b) => a - b).join(', ');

  return {
    code: verdict.code,
    severity: 'error',
    message: verdict.message,
    subject: { role: 'fact', uri: `fixtures/arrivals/${name}.json`, detail: `arrival [${arrival}]` },
    related: [
      {
        role: 'fact',
        uri: `fixtures/arrivals/${name}.json`,
        detail: `arrival [${arrival}] over connected {${users}}: ${wire}`,
      },
      ...pairedRows(caseWorld, witness).map((row) => ({
        role: 'observation',
        uri: `witness/${model}`,
        detail: `expected ${row.expected} | actual ${row.actual} [${row.state}]`,
      })),
      { role: 'axiom', uri: ORDERED_ROUTING, detail: ORDERED_ROUTING_RATIONALE },
    ],
    evaluationId: `${ORDERED_ROUTING}:arrival-${name}`,
  };
}

const witness = arrivalOrderWitness(world);
const flags = check(world, witness);

if (flags.length === 0) {
  throw new Error('expected the arrival-order witness to miss a delivery for arrival 4231; check() returned no flags');
}

const diagnostic = flagsToGovernance(ARRIVAL_NAME, world, witness, 'arrival-order');

// CIT-247 lesson-2: the same arrival, a different real witness
// (`reorderBufferWitness` -- hold each event until every lower sequence has
// applied, then release in order). Verified live before writing this file:
// `check()` returns no flags for this witness on this arrival, i.e. it
// really does deliver what arrival-order missed. Shaped with the same glue
// as the first diagnostic, at `severity: 'info'` since `flagsToGovernance`
// only names a real flag's kind and this witness raises none -- the PASS
// case needs its own code/message, not an absent flags[0].
function passingGovernance(name, caseWorld, passingWitness, model) {
  const verdict = followerMazeAxiom(name, { world: caseWorld, witness: passingWitness });
  const arrival = caseWorld.arrivals.map((event) => event.sequence).join(',');
  const wire = caseWorld.arrivals.map((event) => event.payload).join(' ');
  const users = [...caseWorld.connectedUsers].sort((a, b) => a - b).join(', ');

  return {
    code: verdict.code,
    severity: 'info',
    message: verdict.message,
    subject: { role: 'fact', uri: `fixtures/arrivals/${name}.json`, detail: `arrival [${arrival}]` },
    related: [
      { role: 'fact', uri: `fixtures/arrivals/${name}.json`, detail: `arrival [${arrival}] over connected {${users}}: ${wire}` },
      ...pairedRows(caseWorld, passingWitness).map((row) => ({
        role: 'observation',
        uri: `witness/${model}`,
        detail: `expected ${row.expected} | actual ${row.actual} [${row.state}]`,
      })),
      { role: 'axiom', uri: ORDERED_ROUTING, detail: ORDERED_ROUTING_RATIONALE },
    ],
    evaluationId: `${ORDERED_ROUTING}:arrival-${name}`,
  };
}

const secondWitness = reorderBufferWitness(world);
const secondFlags = check(world, secondWitness);

if (secondFlags.length !== 0) {
  throw new Error('expected the reorder-buffer witness to pass arrival 4231; check() returned flags');
}

const secondDiagnostic = passingGovernance(ARRIVAL_NAME, world, secondWitness, 'reorder-buffer');

class GhostTraceAgent {
  turn = 0;

  async initialize() {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
    };
  }

  async newSession() {
    return { sessionId: 'sess_ghost-01' };
  }

  async prompt() {
    this.turn += 1;
    return {
      stopReason: 'end_turn',
      _meta: { diagnostic: this.turn === 1 ? diagnostic : secondDiagnostic },
    };
  }
}

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin);
const stream = acp.ndJsonStream(input, output);
const agent = new GhostTraceAgent();

acp
  .agent({ name: 'ghost-trace-agent' })
  .onRequest('initialize', () => agent.initialize())
  .onRequest('session/new', () => agent.newSession())
  .onRequest('session/prompt', () => agent.prompt())
  .connect(stream);
