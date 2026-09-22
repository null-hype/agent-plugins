#!/usr/bin/env node
// CIT-246: produces this lesson's actual fixture by running a real ACP
// client/agent exchange and capturing the literal newline-delimited JSON-RPC
// frames that cross the wire between them -- not typed-out JSON pretending
// to be one. Loosely modeled on
// agentclientprotocol/typescript-sdk's src/examples/client.ts, trimmed to a
// single non-interactive prompt turn (CIT-245's boundary: minimal
// request/diagnostic exchange only, no branching/approval scenario).
//
// This is a one-off evidence-producing script, not build infrastructure:
// CIT-245 explicitly deferred the Playwright recording/reporter pipeline,
// and this script is not that pipeline -- it has no watcher, no CI wiring,
// nothing calls it automatically. It exists so the fixture's provenance is
// checkable: run it again and diff the output.
//
// Reproduce:
//   mkdir /tmp/acp-capture && cd /tmp/acp-capture
//   npm init -y && npm install @agentclientprotocol/sdk@1.5.0
//   cp <this file> ghost-trace-agent.mjs .
//   node capture-ghost-trace-v1.mjs
// Expect byte-identical frames (the agent's sessionId and diagnostic are
// fixed on purpose -- see ghost-trace-agent.mjs) except `capturedAt`, which
// is real wall-clock time and will differ on every run.
import { spawn } from 'node:child_process';
import { Readable, Writable, Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import * as acp from '@agentclientprotocol/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentPath = join(__dirname, 'ghost-trace-agent.mjs');

const agentProcess = spawn(process.execPath, [agentPath], {
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
      session.prompt('Why did the last write to the ledger fail?');

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

// Parse each captured ndjson line back into a JSON-RPC envelope, keeping only
// the two request/response pairs this lesson's fixture actually needs:
// session/prompt (the client's request) and its result (the agent's
// diagnostic reply). `initialize`/`session/new` happened for real too, but
// this lesson's breakpoint starts after session setup, same as the fixture
// this replaces.
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
const promptRequest = frames.find(
  (f) => f.direction === 'client->agent' && f.envelope.method === 'session/prompt',
);
const promptResponse = frames.find(
  (f) => f.direction === 'agent->client' && f.envelope.id === promptRequest.envelope.id && f.envelope.result,
);

if (!promptRequest || !promptResponse) {
  throw new Error('capture did not produce the expected session/prompt request/response pair');
}

const fixtureFrames = [
  {
    actor: 'client',
    action: 'send prompt',
    envelope: promptRequest.envelope,
    provenance: {
      recordingId: 'ghost-trace-v1#0',
      capturedAt,
    },
  },
  {
    actor: 'agent',
    action: 'reply with diagnostic',
    envelope: promptResponse.envelope,
    provenance: {
      recordingId: 'ghost-trace-v1#1',
      capturedAt,
    },
  },
];

const starter = {
  scenario: 'ghost-trace-diagnostic-v1',
  frames: [fixtureFrames[0]],
  nextTurn: { actor: 'agent', action: 'reply with diagnostic' },
};

const solution = {
  scenario: 'ghost-trace-diagnostic-v1',
  frames: fixtureFrames,
  nextTurn: null,
};

writeFileSync('acp-trace.starter.json', JSON.stringify(starter, null, 2) + '\n');
writeFileSync('acp-trace.solution.json', JSON.stringify(solution, null, 2) + '\n');
writeFileSync('wire-transcript.jsonl', frames.map((f) => `${f.direction} ${JSON.stringify(f.envelope)}`).join('\n') + '\n');

console.error('Wrote acp-trace.starter.json, acp-trace.solution.json, wire-transcript.jsonl');
