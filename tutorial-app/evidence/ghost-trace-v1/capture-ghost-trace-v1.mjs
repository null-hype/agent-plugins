#!/usr/bin/env node
// CIT-246: produces this lesson's actual fixture by running a real ACP
// client/agent exchange and capturing the literal newline-delimited JSON-RPC
// frames that cross the wire between them -- not typed-out JSON pretending
// to be one. Loosely modeled on
// agentclientprotocol/typescript-sdk's src/examples/client.ts, trimmed to two
// non-interactive prompt turns in one session (CIT-245's boundary: minimal
// request/diagnostic exchange, no branching/approval scenario -- CIT-247
// added the second turn for lesson-2's continuity, still no branching).
//
// This is a one-off evidence-producing script, not build infrastructure:
// CIT-245 explicitly deferred the Playwright recording/reporter pipeline,
// and this script is not that pipeline -- it has no watcher, no CI wiring,
// nothing calls it automatically. It exists so the fixture's provenance is
// checkable: run it again and diff the output.
//
// Reproduce (Node 22.6+, for `--experimental-strip-types`):
//   mkdir /tmp/acp-capture && cd /tmp/acp-capture
//   npm init -y && npm install @agentclientprotocol/sdk@1.5.0
//   cp <this-dir>/*.mjs <this-dir>/*.ts <this-dir>/*.json .
//   node --experimental-strip-types capture-ghost-trace-v1.mjs
// Expect byte-identical frames (the agent's sessionId and its computed
// diagnostic are reproducible on purpose -- see ghost-trace-agent.mjs) except
// each frame's `capturedAt`, which is real wall-clock time and will differ on
// every run.
import { spawn } from 'node:child_process';
import { Readable, Writable, Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import * as acp from '@agentclientprotocol/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentPath = join(__dirname, 'ghost-trace-agent.mjs');

const agentProcess = spawn(process.execPath, ['--experimental-strip-types', agentPath], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

// Wire tap: logs the exact bytes crossing each direction, unmodified, so the
// captured frames below are the literal wire content, not a reconstruction
// from the SDK's parsed objects.
const wire = [];
function tap(direction) {
  return new Transform({
    transform(chunk, _enc, callback) {
      wire.push({ direction, text: chunk.toString('utf8') });
      callback(null, chunk);
    },
  });
}

const toAgent = tap('client->agent');
toAgent.pipe(agentProcess.stdin);
const fromAgent = tap('agent->client');
agentProcess.stdout.pipe(fromAgent);

const input = Writable.toWeb(toAgent);
const output = Readable.toWeb(fromAgent);
const stream = acp.ndJsonStream(input, output);

const capturedAt = new Date().toISOString();

try {
  const promptResult = await acp.client({ name: 'ghost-trace-client' }).connectWith(stream, async (ctx) => {
    await ctx.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    });

    return ctx.buildSession(process.cwd()).withSession(async (session) => {
      // CIT-247: matches the real followermaze case ghost-trace-agent.mjs
      // computes its diagnostic from (arrival order 4,2,3,1, arrival-order
      // witness) -- the prompt names the actual missing delivery, not a
      // placeholder question the diagnostic doesn't answer.
      session.prompt("Why didn't user 10 get the status update from arrival order 4,2,3,1?");

      for (;;) {
        const message = await session.nextUpdate();
        if (message.kind === 'stop') {
          break;
        }
      }

      // CIT-247 lesson-2: a second real turn in the same session, still a
      // one-off capture (no branching/interactivity) -- the agent's second
      // reply is computed from the reorder-buffer witness over the same
      // arrival, see ghost-trace-agent.mjs.
      session.prompt('Would the reorder-buffer model have delivered it?');

      for (;;) {
        const message = await session.nextUpdate();
        if (message.kind === 'stop') {
          return message.response;
        }
      }
    });
  });

  console.error('Agent completed with stopReason:', promptResult.stopReason);
} finally {
  agentProcess.kill();
}

// Parse each captured ndjson line back into a JSON-RPC envelope. Keeps both
// session/prompt request/response pairs this capture now produces:
// lesson-1's (the first turn) and lesson-2's (the second, same session).
// `initialize`/`session/new` happened for real too, but this part's lessons
// start their breakpoint after session setup, same as before.
function parseLines(entries) {
  const frames = [];
  for (const entry of entries) {
    for (const line of entry.text.split('\n')) {
      if (!line.trim()) continue;
      frames.push({ direction: entry.direction, envelope: JSON.parse(line) });
    }
  }
  return frames;
}

const frames = parseLines(wire);
const promptRequests = frames
  .filter((f) => f.direction === 'client->agent' && f.envelope.method === 'session/prompt')
  .sort((a, b) => a.envelope.id - b.envelope.id);

if (promptRequests.length !== 2) {
  throw new Error(`expected exactly 2 session/prompt requests (one per lesson turn), got ${promptRequests.length}`);
}

function responseFor(request) {
  const response = frames.find(
    (f) => f.direction === 'agent->client' && f.envelope.id === request.envelope.id && f.envelope.result,
  );
  if (!response) {
    throw new Error(`no response found for session/prompt id ${request.envelope.id}`);
  }
  return response;
}

const [firstRequest, secondRequest] = promptRequests;
const firstResponse = responseFor(firstRequest);
const secondResponse = responseFor(secondRequest);

function frame(actor, action, envelope, recordingId) {
  return { actor, action, envelope, provenance: { recordingId, capturedAt } };
}

const lesson1Frames = [
  frame('client', 'send prompt', firstRequest.envelope, 'ghost-trace-v1#0'),
  frame('agent', 'reply with diagnostic', firstResponse.envelope, 'ghost-trace-v1#1'),
];

const lesson2SecondRequestFrame = frame('client', 'send prompt', secondRequest.envelope, 'ghost-trace-v1#2');
const lesson2Frames = [
  ...lesson1Frames,
  lesson2SecondRequestFrame,
  frame('agent', 'reply with diagnostic', secondResponse.envelope, 'ghost-trace-v1#3'),
];

writeFileSync(
  'acp-trace.starter.json',
  JSON.stringify(
    { scenario: 'ghost-trace-diagnostic-v1', frames: [lesson1Frames[0]], nextTurn: { actor: 'agent', action: 'reply with diagnostic' } },
    null,
    2,
  ) + '\n',
);
writeFileSync(
  'acp-trace.solution.json',
  JSON.stringify({ scenario: 'ghost-trace-diagnostic-v1', frames: lesson1Frames, nextTurn: null }, null, 2) + '\n',
);
writeFileSync(
  'acp-trace.lesson2.starter.json',
  JSON.stringify(
    {
      scenario: 'ghost-trace-diagnostic-v1',
      frames: [...lesson1Frames, lesson2SecondRequestFrame],
      nextTurn: { actor: 'agent', action: 'reply with diagnostic' },
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(
  'acp-trace.lesson2.solution.json',
  JSON.stringify({ scenario: 'ghost-trace-diagnostic-v1', frames: lesson2Frames, nextTurn: null }, null, 2) + '\n',
);
writeFileSync('wire-transcript.jsonl', frames.map((f) => `${f.direction} ${JSON.stringify(f.envelope)}`).join('\n') + '\n');

console.error(
  'Wrote acp-trace.starter.json, acp-trace.solution.json, acp-trace.lesson2.starter.json, acp-trace.lesson2.solution.json, wire-transcript.jsonl',
);
