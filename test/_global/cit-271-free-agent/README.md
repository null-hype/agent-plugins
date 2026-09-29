# cit-271-free-agent — the CIT-271 detector harness

Runs the [CIT-265](../../../docs/investigations/CIT-265.md) hint-ladder
experiment for [CIT-271](https://linear.app/citizen6librarian6refrain4/issue/CIT-271):
a fresh, no-access agent reads the level-0 fixture state and reports the
security weaknesses it finds; we record the transcript as a trace. **This is
the harness, not the result** — scoring the traces (rank of
`variant_processor`/libvips against the full flag list, positive vs. control)
is CIT-276's job.

## Shape: one scenario per hint level

`cit-271-free-agent-hint0` … `hint3` are four `test/_global` scenarios sharing
this one build context. Each runs in its **own fresh container**, so hint level
N never shares a filesystem or `~/.claude` session with level M. The four thin
scripts (`../cit-271-free-agent-hintN.sh`) only set `CIT271_HINT_LEVEL` and
source the image-baked `run-detector.sh`, which loops the two states
(`positive`, the `:mini_magick` matched `control`) × `CIT271_REPEATS`.

Run all four (skips cleanly without `PROTON_PASS_PERSONAL_ACCESS_TOKEN`):

```
devcontainer features test --global-scenarios-only .
```

## Isolation (what's structural, what isn't)

- **No repo** — the repo isn't mounted into the scenario container.
- **No Linear / no MCP** — `--strict-mcp-config` + an empty MCP config, so the
  base image's Linear MCP is not loaded.
- **No web / no tools** — `--allowedTools=` (empty allowlist); the turn answers
  in text only. API egress stays up (the turn needs it); do not use
  `--network none`.
- **Answer-key tripwire** — `run-detector.sh` fails a level-0–2 run if the
  assembled prompt contains this CVE's identifiers. Level 3 names the CVE by
  design ("ceiling check"); ImageTragick at level 2 is an allowed analogy.
- **Cannot be closed here: model knowledge** — the weights may know the pre-fix
  source; Jev's cutoff is unpublished. That caveat is CIT-273's and every trace
  inherits it.

## State files

`state-positive.json` / `state-control.json` are the `.state` object (only
`diff_items` + `files`, never `meta`/`expected`) of the CIT-281 fixtures.
Regenerate after any fixture change:

```
jq '.state' docs/investigations/CIT-265/fixture-active-storage.json   > test/_global/cit-271-free-agent/state-positive.json
jq '.state' docs/investigations/CIT-265/fixture-negative-control.json > test/_global/cit-271-free-agent/state-control.json
```

## Verify before trusting a live run

1. **`--allowedTools=` semantics** on the pinned `claude` version — confirm an
   empty allowlist denies *every* tool. If it falls back to defaults, switch to
   `--disallowedTools=WebSearch,WebFetch,Bash,Read,Edit,Write`.
2. **Hint text** — the ladder strings in `run-detector.sh` are reproduced from
   the CIT-265 issue body; lift them verbatim from the canonical source.
3. **Build-context resolution** — the four scenarios point `build.dockerfile`
   /`context` at this shared dir; the first CI build confirms the CLI resolves
   that path as expected.
