# tk-evidence-exporter (CIT-147, slice 1)

Turns one completed GitHub Actions feature-test run plus its restic
snapshot(s) into a versioned, Pkl-validated evidence package, as a first
slice of [CIT-147](../CLAUDE.md)'s execution-to-Tutorial-Kit pipeline. It
does **not** publish anything into `null-hype/null-hype.github.io` -- that
repo isn't available from this one. This module's output is the contract a
future PR there consumes (building on that repo's own `#38`, "Retrospective
MCP Results as Tutorial Kit Evidence Workspace").

## Why this exists, and what it deliberately doesn't do

CIT-147 asks for the full request → decision → evaluation → observation →
reconciliation capability-spike lesson (CIT-139/CIT-146). That scenario isn't
wired into a devcontainer feature test yet (CIT-146), so this slice proves
the exporter pipeline end to end against a scenario that already exists and
already produces restic snapshots today: `test/pass-cli/restic-backup.sh`.
The schema (`pkl/Evidence.pkl`) already models the capability-spike's
fact/grant/observation/reconciliation entities field-for-field against the
real Go types in `capability-spike/`, so wiring in CIT-146's scenario later
is additive -- point `-junit-dir` at its `pkl test --junit-reports` output
and `CapabilityFacts` populates for real (see `internal/export.
CapabilityFactsFromChecks`, exercised today against capability-spike's own
existing fact fixtures in the test suite).

## Input

| Flag | Source | Required |
|---|---|---|
| `-repo`, `-run-id`, `-run-attempt`, `-job-name`, `-server-url`, `-sha`, `-github-token` | `$GITHUB_REPOSITORY`/`$GITHUB_RUN_ID`/`$GITHUB_RUN_ATTEMPT`/`$GITHUB_JOB`/`$GITHUB_SERVER_URL`/`$GITHUB_SHA`/`$GITHUB_TOKEN` (ambient in Actions) | repo, run-id |
| `-scenario` | the scenario name (used consistently for the feature/assignment/snapshot-tag/lesson identity) | yes |
| `-snapshots-json` | `restic snapshots --tag <scenario> --json` output | no (omitted when the scenario ended, e.g. skipped or failed, before capturing any snapshot) |
| `-ls-json` | `restic ls <snapshotID> --json` output | no |
| `-diff-json` | `restic diff <id1> <id2> --json` output (only when a snapshot pair exists) | no |
| `-junit-dir` | a directory of `pkl test --junit-reports` XML files, one per fact module | no |
| `-scenario-outcome-json` | a `{"outcome":"passed"\|"failed"\|"skipped"}` file the scenario script itself wrote | no, but strongly preferred (see below) |
| `-out` | output directory (default `build`) | no |

### Scenario outcome: `-scenario-outcome-json`, or an explicit `eval-error`

`-scenario-outcome-json` is the scenario's own structured verdict, written
directly by the scenario script (see `test/pass-cli/restic-backup.sh`'s
`on_exit` trap, which writes it on every exit path from the script's own
exit code). When it's given, `scenario.outcome` comes from it, full stop.

When it's *not* given, `scenario.outcome` is `"eval-error"` -- not a guess
derived from this run's own GitHub Actions job conclusion. An earlier
version of this exporter did fall back to the job conclusion
(`internal/ghactions`), but that was a materially weaker signal for two
reasons that made it actively wrong for `test-global.yaml`'s actual shape:

- **The job may still be in progress.** The exporter step runs later in the
  same job whose conclusion it would be reading -- a job's `conclusion`
  field is only set once the job finishes, so reading it from a step inside
  that same job reads an empty string, which `ghactions.Outcome` maps to
  `failed` regardless of whether the scenario actually passed.
- **The job is not scenario-scoped.** `test-scenarios` runs every scenario
  (feature-local and global) in one `devcontainer features test`
  invocation, so even *after* the job finishes, its conclusion tells you
  whether *any* scenario failed, not whether `restic-backup` specifically
  did.

Silently mapping either of those into a real `passed`/`failed` verdict
misrepresents "we don't actually know" as a known outcome -- `eval-error` is
the honest signal instead. `test-global.yaml` now discovers evidence by
`scenario-outcome.json` first (see "Not verified here" below and the
workflow's own comments) specifically so it can always pass
`-scenario-outcome-json` whenever `restic-backup.sh` ran at all; the
`eval-error` fallback in `cmd/export` itself remains for direct/manual
invocations that omit the flag.

**Deliberately not an input:** this workflow's own `devcontainer features
test` stdout. `dev-container-features-test-lib` (the bash lib the
devcontainer CLI injects into every scenario) has no output format contract
-- only emoji-decorated text. Scenario-level pass/fail instead comes from a
real structured source: preferably the scenario script's own
`-scenario-outcome-json` verdict (see above), falling back to the GitHub
Actions Jobs API (`internal/ghactions`) when that's absent; per-check
granularity, where it exists at all, comes from an actual structured test
runner underneath the scenario (`pkl test --junit-reports` for a
Pkl-test-backed scenario). A scenario with no such runner underneath it
(like `restic-backup`, plain bash `check`/`reportResults`) legitimately has
no per-check breakdown -- see `ScenarioResult.checks` staying empty in that
case, and the warning `Diagnose` emits when that happens alongside a failed
outcome.

## Output

`<out>/evidence.json`: the full `evidence.Package` (see
`internal/evidence/types.go`, which mirrors `pkl/Evidence.pkl` field for
field), after being rendered as Pkl source and evaluated by a real `pkl-go`
evaluator against that schema -- an evaluation failure (bad enum value,
missing required field) aborts the export rather than shipping a package
that only looks right in Go.

## Invocation

Locally, or as a CI step (see `.github/workflows/test-global.yaml`'s "Export
restic-backup scenario evidence" step for the real invocation against a live
run):

```
cd tk-evidence-exporter
go run ./cmd/export \
  -scenario restic-backup \
  -snapshots-json /path/to/restic-snapshots.json \
  -ls-json /path/to/restic-ls.json \
  -scenario-outcome-json /path/to/scenario-outcome.json \
  -out build/tk-evidence
```

`cmd/export` calls into a native `pkl` binary via `pkl-go` to validate the
assembled package -- it must be on `PATH` (the root `mise.toml` declares
`pkl = "latest"`, the same configuration every devcontainer/sandbox in this
repo shares -- not a fixed version pin; `test-global.yaml` installs it via
`jdx/mise-action` against that same `mise.toml`).

## TypeScript bindings

`ts/evidence.pkl.ts` is generated from `pkl/Evidence.pkl` by
[`@pkl-community/pkl-typescript`](https://npm.im/@pkl-community/pkl-typescript)
(confirmed working against this schema -- union-of-string-literal types like
`Outcome`/`FlagKind` and doc comments both come through correctly). It's
committed, not gitignored, since it's the artifact `null-hype.github.io`
vendors. Regenerate it after any `pkl/Evidence.pkl` change with:

```
npx @pkl-community/pkl-typescript -o ts pkl/Evidence.pkl
```

TK's practical consumption path is typing the exported `evidence.json`
directly against `EvidencePackage` from this file (`import type {
EvidencePackage } from "./evidence.pkl"`), not calling the generated
`loadFromPath`/`load` runtime helpers -- those evaluate a Pkl *schema*
module (which has no top-level `EvidencePackage` value of its own, only
class/type definitions) and would require a `pkl` binary at TK's runtime,
which the exported JSON doesn't need.

## Provenance and validation claims

`ValidationResult` (inside the package) separates two independently
identifiable verdicts, per CIT-147's ask to keep the recorded domain verdict
and the exporter's own package-validation verdict distinguishable:

- **`StructurallyValid`**: did the assembled package evaluate cleanly
  against `pkl/Evidence.pkl`? This is a real Pkl evaluation result, not a
  Go-side approximation of one.
- **`ValidationErrors`**: cross-field consistency warnings `internal/export.
  Diagnose` finds that the schema's types alone can't express (e.g. the
  scenario name used inconsistently across `execution`/`scenario`, a
  snapshot tagged differently than the scenario name, a failed scenario with
  no per-check detail because no structured runner exists underneath it).
  These are actionable diagnostics for incomplete/inconsistent evidence, not
  fatal errors -- the export still completes and records them.
- **`ArtifactHashes`**: sha256 of every raw input file consumed (the restic
  JSON files, any JUnit XML files) -- for verifying the packaged evidence
  actually corresponds to specific captured artifacts, not just asserting it
  does. This is a `Listing<ArtifactHash>` (`{path, sha256}` records), not a
  Pkl `Mapping`/Go `map` -- the exported JSON transport is a plain array
  (`encoding/json` has no way to marshal a Go map as a native JS `Map`), so
  modeling it as one directly keeps the generated TypeScript binding
  (`Array<ArtifactHash>`) honest about the shape a consumer actually
  receives from `evidence.json`.

## Snapshot identity

Every snapshot-derived value in the package is bound back to the exact
snapshot it came from, not just to "the scenario's tag":

- `execution.snapshotId` is the exact restic snapshot ID `color` produced
  *during this run*. `color`'s own `restic backup ... --json` call (see
  `src/pass-cli/install.sh` and `src/pass-cli/NOTES.md`) writes its trailing
  `"summary"` line -- including `snapshot_id` -- to a fixed path;
  `restic-backup.sh` reads that file directly rather than querying `restic
  snapshots --tag <scenario>` and guessing which result is "this run's."
  This restic repo is a persistent remote backend shared across CI runs, so
  even a before/after set difference against that query (an earlier version
  of this capture) can't fully rule out a concurrent run's snapshot landing
  in the same window -- the backup call's own return value isn't a query
  against the shared remote at all, so it doesn't have that ambiguity.
  `restic-backup.sh` also restores this exact ID (not `restic restore
  latest --tag <scenario>`, which has the same concurrency hazard), falling
  back to `latest` only if the exact ID is unexpectedly unavailable.
- `fileTree[].snapshotId` comes from `restic ls`'s own "snapshot" header
  line, not from whatever ID the caller happened to ask for.
- `diff[].fromSnapshotId`/`toSnapshotId` come from `restic diff`'s own
  trailing "statistics" line (`source_snapshot`/`target_snapshot`), not
  re-derived from the top-level `snapshots` listing, which a given diff may
  not even fully overlap with.

`internal/export.Diagnose` cross-checks these against each other (e.g.
`execution.snapshotId` actually appearing in `snapshots`, `fileTree` entries
matching `execution.snapshotId`) and emits an actionable warning, not a
silent gap, when they disagree.

## The exported JSON is the real contract, not just the Pkl shape

Every `evidence` struct field carries an explicit `json` tag matching its
`pkl` tag's camelCase name (see `internal/evidence/types.go`) -- Go's
default PascalCase field-name marshaling would otherwise produce a JSON
document (`SchemaVersion`, `Execution`, ...) that doesn't match what
`ts/evidence.pkl.ts`'s generated interfaces (`schemaVersion`, `execution`,
...) actually describe. `cmd/export`'s end-to-end test run (see "Verified so
far" below) asserts the real `evidence.json` output against those exact
field names, not just against the Go struct shape.

What this package does **not** claim: that the log-scrape captured every
check a scenario ran (there is no log scrape -- see above), or that a
non-Pkl scenario's domain outcome has per-check granularity when no
structured runner exists to provide it.

## Verified so far (this sandbox)

- `pkl eval pkl/Evidence.pkl` and `pkl eval testdata/schema_smoke.pkl`: the
  schema evaluates standalone and accepts a hand-built instance; a bad
  `outcome` value is confirmed rejected by Pkl itself (not just Go-side
  validation).
- `go test ./...`: `internal/pkljunit` and `internal/resticparse` are tested
  against **real** captured fixtures -- `pkl test --junit-reports` run
  against capability-spike's actual `worker/*.pkl` fact files (including a
  genuine pre-`GrantState.pkl` eval-error, to prove that's not
  misclassified as a domain "failed"), and `restic snapshots/ls/diff --json`
  run against a real scratch restic repository with two backups.
- `cmd/export` run end-to-end against those same real fixtures plus a mocked
  GitHub Actions Jobs API server, producing a validated `evidence.json`
  whose actual field names (`schemaVersion`, `execution.snapshotId`,
  `fileTree[].snapshotId`, `diff[].fromSnapshotId`/`toSnapshotId`,
  `validation.artifactHashes` as an array) were inspected directly, not just
  asserted via `go test`.
- `cmd/export` run three more ways end-to-end against the mocked Jobs API,
  with the resulting `evidence.json` inspected directly: (1) with neither
  `-snapshots-json` nor `-scenario-outcome-json` given, confirming
  `scenario.outcome` is `"eval-error"` (not a fabricated `"failed"`) and
  `snapshots`/`fileTree`/etc. are `[]`, not `null`; (2) with a real
  scenario-outcome/snapshots/ls fixture set producing zero `Diagnose`
  warnings, confirming `validationErrors` is `[]`, not `null` -- the fix for
  a real bug where that field was assigned directly from a possibly-nil Go
  slice, bypassing Pkl re-evaluation. The `jq -rs 'map(select(.message_type
  == "summary")) | .[-1].snapshot_id // empty'` expression `restic-backup.sh`
  now uses to read `color`'s own backup summary was tested standalone
  against synthetic `restic backup --json` output shaped like restic's
  documented summary line, both with and without a matching line present.
- `npx @pkl-community/pkl-typescript -o ts pkl/Evidence.pkl` regenerated
  after the snapshot-identity/`ArtifactHash` schema changes above --
  `ts/evidence.pkl.ts`'s `artifactHashes: Array<ArtifactHash>` now matches
  the real JSON shape `cmd/export` produces, rather than the `Map<string,
  string>` a Pkl `Mapping` used to generate (which no JSON payload could
  ever actually satisfy).
- The `test-global.yaml` wiring's key assumption -- that `devcontainer
  features test` bind-mounts a host-writable directory into the scenario
  container at the test script's own working directory -- was confirmed by
  directly inspecting the CLI's own `docker run --mount type=bind,...`
  invocation (`npx @devcontainers/cli features test --preserve-test-containers`
  against this repo). The mount itself couldn't be exercised to completion
  in this sandbox (its Docker daemon runs outside this container, so the
  bind source path only exists in the CLI's, not the daemon's, filesystem --
  a nested-sandbox artifact, not something a real `ubuntu-latest` runner
  hits).

## Not verified here (needs a real `workflow_dispatch` run)

- That `restic-backup.sh`'s evidence actually lands under
  `/tmp/devcontainercli/container-features-test/*/evidence/` on a real
  runner and the workflow's `find` picks it up. The underlying mount
  mechanism is confirmed (see above); the full round trip on a real,
  non-nested runner is not.
- Live GitHub Actions Jobs API behavior against a real run/job (the test
  suite exercises `internal/ghactions` against a mocked server, not the real
  API) -- though this is now only relevant to a direct/manual `cmd/export`
  invocation that omits `-scenario-outcome-json`; `test-global.yaml` itself
  always passes that flag when `restic-backup.sh` ran at all.
- `color`'s `restic backup --json` writing a real, parseable summary line to
  `/tmp/pass-cli-restic-backup.json`, and `restic-backup.sh`'s `on_exit`
  trap, against real `pass-cli`/restic/GCP credentials -- this sandbox has
  none of those, so this logic was only checked via `bash -n` and the `jq`
  summary-extraction expression tested standalone against synthetic
  `--json` output shaped like restic's documented summary line (see
  "Verified so far" below), not by actually running `color`/the scenario.
- `jdx/mise-action` actually installing `pkl` (per this repo's `mise.toml`)
  onto a real `ubuntu-latest` runner's `PATH` before `cmd/export` runs --
  not exercisable without a live `workflow_dispatch`.
