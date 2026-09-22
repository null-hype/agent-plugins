# Ghost trace `v1` capture evidence

CIT-246: the lesson at `src/content/tutorial/part-2/chapter-1/lesson-1` shows
a client `session/prompt` request and an agent diagnostic response, lifted
verbatim from a real, minimal ACP client/agent exchange captured here -- not
hand-typed JSON authored to look like one.

CIT-247: the agent's diagnostic is no longer a hand-typed message either. It
is computed by really running Follower Maze's own `check()`/
`followerMazeAxiom()` (vendored here, see `followerMaze.ts`'s header) over
one genuine arrival ordering with a genuine witness model, and the same
capture now drives a *second* real turn in the same session -- a different
witness over the same arrival -- which became lesson 2
(`src/content/tutorial/part-2/chapter-1/lesson-2`), continuing directly from
lesson 1's solved state.

This directory is evidence, not build infrastructure. Nothing in the app
imports or runs these scripts; they exist so the fixtures' provenance is
checkable. CIT-245 deferred the Playwright recording/reporter pipeline; this
is not that pipeline (no watcher, no CI wiring, no general recording
capability) -- it is a single one-off script, run once, whose raw output was
copied into both lessons' `_files`/`_solution` fixtures.

## Files

- `ghost-trace-agent.mjs` -- a minimal ACP agent (loosely modeled on
  `agentclientprotocol/typescript-sdk`'s `src/examples/agent.ts`) that
  answers two `session/prompt` turns in one session. Each reply's
  `_meta.diagnostic` is computed, not typed: the first from
  `arrivalOrderWitness` (misses a delivery), the second from
  `reorderBufferWitness` (delivers everything) -- both against the same real
  arrival ordering. `newSession` returns a fixed `sessionId` (a real agent
  would randomize it) so the capture is reproducible.
- `followerMaze.ts` -- vendored verbatim from
  `../../src/lesson-farms/follower-maze/followerMaze.ts` (see its own header
  comment). Copied rather than imported because this directory's scripts run
  standalone under plain Node, outside the Vite/Astro build, and this module
  happens to have zero imports of its own so it runs as-is.
- `world.json`, `arrival-4231.json` -- vendored verbatim from
  `../../src/lesson-farms/follower-maze/fixtures/`: the same connected-users/
  events world and the same arrival ordering (`4,2,3,1`) Follower Maze's own
  lesson already uses, not a fixture invented for this capture.
- `capture-ghost-trace-v1.mjs` -- spawns the agent above as a real
  subprocess, drives it through a real client connection for two prompt
  turns (loosely modeled on that SDK's `src/examples/client.ts`), and taps
  the literal newline-delimited JSON-RPC bytes crossing the wire in both
  directions. Writes `acp-trace.starter.json`/`acp-trace.solution.json`
  (lesson 1) and `acp-trace.lesson2.starter.json`/
  `acp-trace.lesson2.solution.json` (lesson 2).
- `wire-transcript.jsonl` -- the full eight-frame exchange this capture
  produces (`initialize`, `session/new`, two `session/prompt` turns, and
  their responses), one line per frame, prefixed with its direction. Only
  the two `session/prompt` request/response pairs became the lessons'
  fixtures; the other four are session setup both lessons' breakpoints start
  after.

## Reproduce

Requires Node 22.6+ (for `--experimental-strip-types`, used to run
`followerMaze.ts` directly with no build step):

```sh
mkdir /tmp/acp-capture && cd /tmp/acp-capture
npm init -y
npm install @agentclientprotocol/sdk@1.5.0
cp <this-repo>/tutorial-app/evidence/ghost-trace-v1/*.mjs .
cp <this-repo>/tutorial-app/evidence/ghost-trace-v1/*.ts .
cp <this-repo>/tutorial-app/evidence/ghost-trace-v1/*.json .
node --experimental-strip-types capture-ghost-trace-v1.mjs
```

Diff the result against `wire-transcript.jsonl` (sha256
`7a1548227bfeadf28b1f1325b1c5a1899e87785b5d003dfdb7f0645f7f05464f`). Every
field is byte-identical across runs except each frame's `capturedAt`, which
is real wall-clock time.

## Dagger Cloud trace

Not yet linked -- see this lesson's `content.mdx` Provenance section.
