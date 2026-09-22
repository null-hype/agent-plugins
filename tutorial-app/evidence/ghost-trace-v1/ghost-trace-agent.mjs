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
import * as acp from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';

class GhostTraceAgent {
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
    return {
      stopReason: 'end_turn',
      _meta: {
        diagnostic: {
          severity: 'error',
          code: 'LEDGER_WRITE_CONFLICT',
          message:
            'The write to Ledger.pkl at revision 4 conflicted with a concurrent approval from the supervisor pass.',
          source: 'acp-ghost-trace',
        },
      },
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
