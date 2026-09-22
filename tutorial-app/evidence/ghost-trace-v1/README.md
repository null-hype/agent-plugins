# Ghost trace `v1` capture evidence

CIT-246: the lesson at `src/content/tutorial/part-2/chapter-1/lesson-1` shows
a client `session/prompt` request and an agent diagnostic response. Both are
lifted verbatim from a real, minimal ACP client/agent exchange captured here
-- not hand-typed JSON authored to look like one.

This directory is evidence, not build infrastructure. Nothing in the app
imports or runs these scripts; they exist so the fixture's provenance is
checkable. CIT-245 deferred the Playwright recording/reporter pipeline; this
is not that pipeline (no watcher, no CI wiring, no general recording
capability) -- it is a single one-off script, run once, whose raw output was
copied into the lesson's `_files`/`_solution` fixtures.

## Files

- `ghost-trace-agent.mjs` -- a minimal ACP agent (loosely modeled on
  `agentclientprotocol/typescript-sdk`'s `src/examples/agent.ts`) that
  answers exactly one `session/prompt` with the recorded diagnostic. It
  returns a fixed `sessionId` (a real agent would randomize it) so the
  capture is reproducible.
- `capture-ghost-trace-v1.mjs` -- spawns the agent above as a real
  subprocess, drives it through a real client connection (loosely modeled
  on that SDK's `src/examples/client.ts`), and taps the literal
  newline-delimited JSON-RPC bytes crossing the wire in both directions.
- `wire-transcript.jsonl` -- the full six-frame exchange this capture
  produced (`initialize`, `session/new`, `session/prompt`, and their three
  responses), one line per frame, prefixed with its direction. Only the
  `session/prompt` request/response pair became the lesson's fixture; the
  other four are session setup this lesson's breakpoint starts after.

## Reproduce

```sh
mkdir /tmp/acp-capture && cd /tmp/acp-capture
npm init -y
npm install @agentclientprotocol/sdk@1.5.0
cp <this-repo>/tutorial-app/evidence/ghost-trace-v1/*.mjs .
node capture-ghost-trace-v1.mjs
```

Diff the result against `wire-transcript.jsonl` (sha256
`73c4b53a7df4e7dd085716a8887ac3d896c368d23f5da1dd98de4675f3e10814`). Every
field is byte-identical across runs except each frame's `capturedAt`, which
is real wall-clock time.

## Dagger Cloud trace

Not yet linked -- see this lesson's `content.mdx` Provenance section.
