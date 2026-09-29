# cit-271-free-agent — the CIT-271 detector harness

Runs the [CIT-265](../../../docs/investigations/CIT-265.md) hint-ladder
experiment for [CIT-271](https://linear.app/citizen6librarian6refrain4/issue/CIT-271):
a fresh, no-access agent reads the level-0 fixture state and reports the
security weaknesses it finds; we record the transcript as a trace. **This is
the harness, not the result** — scoring the traces (rank of
`variant_processor`/libvips against the full flag list, positive vs. control)
is CIT-276's job.

## Shape: one scenario per hint level

`cit-271-free-agent-hint0` … `hint3` are four `test/_global` scenarios that
share this one directory. Each runs in its **own fresh container** off the same
`devenv-linear-agent` base image (`"image"`, no per-scenario build), so hint
level N never shares a filesystem or `~/.claude` session with level M. The four
thin scripts (`../cit-271-free-agent-hintN.sh`) only set `CIT271_HINT_LEVEL`,
then source the shared `run-detector.sh`, which loops the two states
(`positive`, the `:mini_magick` matched `control`) × `CIT271_REPEATS`.

Why `"image"` and not a per-scenario `build`: the devcontainer-features-test
framework only copies a scenario's build collateral from a directory named
*exactly* the scenario key (`test/_global/<scenario>/`), which would force four
near-identical Dockerfile dirs. Instead the framework copies **all** of
`test/_global` into the mounted test workspace, so each thin script sources
`run-detector.sh` (and it reads the state files + `.env`) from this shared
directory at run time — one source of truth, no per-level duplication.

Run all four (skips cleanly without `PROTON_PASS_PERSONAL_ACCESS_TOKEN`):

```
devcontainer features test --global-scenarios-only .
```

## Isolation (what's structural, what isn't)

- **No repo** — the repo isn't mounted into the scenario container.
- **No Linear / no MCP** — `--strict-mcp-config` + an empty MCP config, so the
  base image's Linear MCP is not loaded.
- **No web / no tools** — `--disallowedTools <full built-in set>` (an *empty*
  `--allowedTools` does **not** work — it filters nothing, so all 30 built-ins
  stay available; verified live). The agent answers in text only. A per-trace
  gate asserts the init event reports **0 tools**, so a future image that adds a
  built-in the deny-list misses fails the test instead of recording a tainted
  run. API egress stays up (the turn needs it); do not use `--network none`.
- **Answer-key tripwire** — `run-detector.sh` fails a level-0–2 run if the
  assembled prompt contains this CVE's identifiers. Level 3 names the CVE by
  design ("ceiling check"); ImageTragick at level 2 is an allowed analogy.
- **Cannot be closed here: model knowledge** — the weights may know the pre-fix
  source; Jev's cutoff is unpublished. That caveat is CIT-273's and every trace
  inherits it.

## What CIT-276 scores, and how to retrieve it

The `~/.claude` **transcript** is the complete behavioural record; the
stream-json traces written to `EVIDENCE_DIR` are only the run-time gate input
(non-empty + `tools==0`) and the `session_id` source. After the runs,
`run-detector.sh` `restic backup`s `~/.claude` (plus a `manifest.jsonl` mapping
each `(hint, state, rep)` → `session_id`) to the shared repo, tagged
`cit-271-hint<level>` — the same mechanism as `src/pass-cli/install.sh`'s
`color` bin and jin-81. CIT-276 restores by tag:

```
restic snapshots --tag cit-271-hint0        # find this level's snapshot(s)
restic restore <id> --target /              # transcripts + manifest come back
```

`manifest.jsonl` (inside the snapshot at `~/.claude/cit-271-manifest-hint<level>.jsonl`)
maps the session-UUID-named transcripts back to the labelled runs.

## State files

`state-positive.json` / `state-control.json` are the `.state` object (only
`diff_items` + `files`, never `meta`/`expected`) of the CIT-281 fixtures.
Regenerate after any fixture change:

```
jq '.state' docs/investigations/CIT-265/fixture-active-storage.json   > test/_global/cit-271-free-agent/state-positive.json
jq '.state' docs/investigations/CIT-265/fixture-negative-control.json > test/_global/cit-271-free-agent/state-control.json
```

## Verify before trusting a live run

1. **Hint text** — the ladder strings in `run-detector.sh` are reproduced from
   the CIT-265 issue body; lift them verbatim from the canonical source.

## Running locally (Codespaces / a devcontainer)

`devcontainer features test` puts its temp workspace under `/tmp`, which the
docker daemon can't bind-mount when you run *inside* a devcontainer (the
daemon resolves bind sources on the host). Point `TMPDIR` at a path the daemon
shares 1:1 — under `/workspaces` in Codespaces — and filter to one scenario:

```
export TMPDIR=/workspaces/.dctest-tmp && mkdir -p "$TMPDIR"
CIT271_REPEATS=1 CIT271_MODEL=haiku TMPDIR="$TMPDIR" \
  devcontainer features test --global-scenarios-only --filter cit-271-free-agent-hint0 .
```

`CIT271_REPEATS` / `CIT271_MODEL` (wired through `containerEnv`) keep a local
smoke run cheap. The restic backup step writes to the **shared** repo, so a
live local run does push a tagged snapshot there.
