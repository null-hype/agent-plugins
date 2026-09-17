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
| `-snapshots-json` | `restic snapshots --tag <scenario> --json` output | yes |
| `-ls-json` | `restic ls <snapshotID> --json` output | no |
| `-diff-json` | `restic diff <id1> <id2> --json` output (only when a snapshot pair exists) | no |
| `-junit-dir` | a directory of `pkl test --junit-reports` XML files, one per fact module | no |
| `-out` | output directory (default `build`) | no |

**Deliberately not an input:** this workflow's own `devcontainer features
test` stdout. `dev-container-features-test-lib` (the bash lib the
devcontainer CLI injects into every scenario) has no output format contract
-- only emoji-decorated text. Scenario-level pass/fail instead comes from the
GitHub Actions Jobs API (`internal/ghactions`), which is a real structured
enum GitHub itself defines and versions; per-check granularity, where it
exists at all, comes from an actual structured test runner underneath the
scenario (`pkl test --junit-reports` for a Pkl-test-backed scenario). A
scenario with no such runner underneath it (like `restic-backup`, plain
bash `check`/`reportResults`) legitimately has no per-check breakdown --
see `ScenarioResult.checks` staying empty in that case, and the warning
`Diagnose` emits when that happens alongside a failed outcome.

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
  -out build/tk-evidence
```

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
  does.

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
  GitHub Actions Jobs API server, producing a validated `evidence.json`.
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
  API).
