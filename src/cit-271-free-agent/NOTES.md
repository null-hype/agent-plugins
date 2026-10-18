# cit-271-free-agent — the CIT-271 detector harness

Runs the [CIT-265](../../docs/investigations/CIT-265.md) hint-ladder
experiment for [CIT-271](https://linear.app/citizen6librarian6refrain4/issue/CIT-271):
a fresh, no-access agent reads the level-0 fixture state and reports the
security weaknesses it finds; we record the transcript as a trace. **This is
the harness, not the result** — scoring the traces (rank of
`variant_processor`/libvips against the full flag list, positive vs. control)
is CIT-276's job.

## Shape: a feature, and one scenario per hint level

This feature is the agent: installed into a container, it runs the detector
when the container starts (its `postStartCommand`, the `cit-271-free-agent`
bin) at its `hintLevel`, looping the two states (`positive`, the
`:mini_magick` matched `control`) × `repeats`, and records the outcome in
`/tmp/cit-271-traces/L<level>/result.json`.

`cit-271-free-agent-hint0` … `hint3` are four `test/_global` scenarios, one
per level, so level N never shares a container, filesystem or `~/.claude`
session with level M. Each script only checks the recorded result
(`test/_global/cit-271-free-agent/checks.sh`). Run all four (they skip cleanly
without `PROTON_PASS_PERSONAL_ACCESS_TOKEN`):

```
devcontainer features test --global-scenarios-only .
```

The same scenario rendered as a template
(`scripts/render-agent-template.py cit-271-free-agent-hint0`) is a codespace
that runs this level when it starts.

## Isolation (what's structural, what isn't)

- **No repo** — the agent runs in an empty working directory.
- **No Linear / no MCP** — `--strict-mcp-config` + an empty MCP config, so the
  base image's Linear MCP is not loaded.
- **No web / no tools** — `--disallowedTools <full built-in set>` (an *empty*
  `--allowedTools` does **not** work — it filters nothing, so all 30 built-ins
  stay available; verified live). The agent answers in text only. A per-trace
  gate asserts the init event reports **0 tools**, so a future image that adds a
  built-in the deny-list misses fails the test instead of recording a tainted
  run. API egress stays up (the turn needs it); do not use `--network none`.
- **Answer-key tripwire** — `run.sh` fails a level-0–2 run if the
  assembled prompt contains this CVE's identifiers. Level 3 names the CVE by
  design ("ceiling check"); ImageTragick at level 2 is an allowed analogy.
- **Cannot be closed here: model knowledge** — the weights may know the pre-fix
  source; Jev's cutoff is unpublished. That caveat is CIT-273's and every trace
  inherits it.

## What CIT-276 scores, and how to retrieve it

The `~/.claude` **transcript** is the complete behavioural record; the
stream-json traces written to `EVIDENCE_DIR` are only the run-time gate input
(non-empty + `tools==0`) and the `session_id` source. After the runs,
`run.sh` `restic backup`s `~/.claude` (plus a `manifest.jsonl` mapping
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
jq '.state' docs/investigations/CIT-265/fixture-active-storage.json   > src/cit-271-free-agent/state-positive.json
jq '.state' docs/investigations/CIT-265/fixture-negative-control.json > src/cit-271-free-agent/state-control.json
```

## Verify before trusting a live run

1. **Hint text** — the ladder strings in `run.sh` are reproduced from
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

`CIT271_REPEATS` / `CIT271_MODEL` (wired through `containerEnv`, and
overriding the feature's `repeats` / `model`) keep a local smoke run cheap. The restic backup step writes to the **shared** repo, so a
live local run does push a tagged snapshot there.
