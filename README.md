# jev-lsp

**Put verified findings back on the source that owns them.**

`jev-lsp` is a small language server for verification results. A verifier writes a durable run containing source-addressed findings and evidence. `jev-lsp` reads that run and publishes diagnostics in the editor.

The verifier can be Playwright, a model checker, static analysis, an agent audit, CI, or something else. The LSP does not run verification and does not depend on the tool that produced the findings.

```text
source code
    │
    ├── verifier ──> .jev/run/findings.json + evidence
    │                         │
    │                         ▼
    └────────────────────> jev-lsp ──> editor diagnostic / go-to-definition
```

This repository is deliberately smaller than the system it was extracted from. There is no Dagger module, delivery planner, agent orchestration, Playwright report, Proton Pass setup, or Jev API client here. Those can be producers of findings; none is part of the LSP contract.

## Why this exists

The useful abstraction is not “a Playwright report in the editor.” It is a **source-addressed verification finding**:

- a location in source;
- a severity and message;
- optional evidence to navigate to;
- optional provenance about the source content that was verified.

That makes the LSP an editor-native verification primitive. Test-driven development is one way to use it: save code, run a verifier, replace the run, and let the diagnostic update where you are already working.

## The entire input contract

A project places its current run at `.jev/run/findings.json`:

```json
{
  "version": 1,
  "findings": [
    {
      "id": "alice-reads-bob",
      "location": { "file": "example.ts", "line": 2, "column": 3 },
      "severity": "warning",
      "message": "Alice can read Bob's private document",
      "sourceHash": "sha256:<hash of example.ts when verified>",
      "evidence": ["evidence/request.json", "evidence/response.json"]
    }
  ]
}
```

`location.file` may be absolute or a path suffix relative to the project. Lines and columns are 1-based. Evidence paths are relative to `.jev/run/`.

`sourceHash` is optional. When present, `jev-lsp` hashes the current editor buffer. If it no longer matches, the diagnostic remains visible but is prefixed `stale finding (verified against other source)`. This avoids coupling freshness to a particular build system or test runner.

The run directory can also be selected explicitly with `JEV_RUN_DIR`.

## Try the example

The checked-in example already contains one recorded finding:

```sh
go build -o jev-lsp .
JEV_RUN_DIR="$PWD/example/.jev/run" ./jev-lsp
```

Normally an editor starts the server. For Neovim 0.11+, put the binary on `PATH` and load:

```lua
dofile('/path/to/jev-lsp/nvim/jev.lua')
```

Open `example/example.ts`. The `return true` line has a warning. Go to definition on that line returns the recorded request and response.

If your verifier should run on save, configure its command before loading the client:

```lua
vim.g.jev_run_cmd = { 'npm', 'test' }
```

The command only needs to replace `.jev/run/findings.json` and any evidence. `jev-lsp` notices the replacement and republishes diagnostics.

## Tests

```sh
go test ./...
```

The Go tests check diagnostic placement, stale-source detection, evidence navigation, and republishing when a verifier replaces the run. CI additionally builds the real server, launches Neovim headlessly, opens the example source, and asserts the editor received the diagnostic and evidence locations.

## What is intentionally not decided yet

This is an extraction to locate the architectural boundary, not a finished interchange standard. Version 1 is intentionally small. In particular, it does not yet specify:

- multiple historical runs;
- a universal provenance model beyond source hashes;
- how a verifier is invoked;
- how findings from several producers are merged;
- installation or packaging beyond building the Go binary.

Those should be added only when a real producer needs them. The first useful invariant is simpler:

> Given a durable verified finding, put it on the source that owns it and let the developer navigate to its evidence.

## Origin

This project was distilled from the `jev-delivery-nodes` work in `null-hype/agent-plugins`. That branch explored Playwright, Dagger, agent delivery, auditing, and editor diagnostics together. The extraction keeps the editor-facing invariant and deliberately leaves the orchestration experiments behind.
