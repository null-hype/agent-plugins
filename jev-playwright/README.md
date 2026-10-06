# Jev question graph — document ownership fix

`report-expected.pcf` defines the question set, Jev instructions, evidence
collectors, required evidence, dependencies, model, and expected probability ranges.
Pkl rejects unknown dependency IDs and cycles before execution.
`playwright.config.ts` evaluates it using the local Pkl CLI adapter and saves
one JSON snapshot for the tests and reporter. No npm Pkl binding is assumed.

The config generates one Playwright project per question, with native project
dependencies. Each test gathers HTTP evidence, asserts the deterministic
behavior, invokes the existing `src/jev/jev` client, and records whether its
score is in range. Only a prerequisite whose answer could not be collected skips
dependent projects; an out-of-range answer is data, and its dependents run. The
reporter only records results.

`run.mjs` ingests Playwright's JSON report and uses `pkl/Reconcile.pkl` to
validate node coverage, dependency order, score ranges, and dependency skips.
A valid score records `in-range` or `out-of-range`; a missing/invalid score
or evidence failure is `execution-failed`. Skipped dependents record
`dependency-skipped` and `blockedBy`. The command fails only when an answer
could not be collected or the graph did not respect its dependencies.

## Example

```text
vulnerability-reproduced
  Alice reads Bob's private document from the baseline app: 200
        ↓
exploit-prevented
  The same request against the patched app: 403
        ↓
legitimate-access-preserved
  Bob reads his own document from the patched app: 200
```

`fixture-app.mjs` serves synthetic accounts and documents on an ephemeral
loopback port. It switches between an allow-any-signed-in-user policy and an
owner-only policy. Each collector captures the actual HTTP response, the
fixture state, and the executed policy source. Dependent nodes also receive
the evidence from their prerequisites. Authentication is represented by fixed
synthetic sessions; only this document-read ownership check is under test.
This is a reproducible patch scenario, not an assessment of a deployed app.

## Run

Requires Node 18+, Python 3.10+, and `pkl` on PATH. Verified with Pkl 0.26.3.
From this directory:

```sh
npm ci
uv venv .venv
uv pip install --python .venv/bin/python pkl-python==0.1.19
npm test
npm run test:contracts
```

No browser installation or credentials are needed for mock scoring. The
HTTP collectors require permission to bind a loopback port. Canned scores of
`0.95` come from `fixtures/answers.json`; they are not Jev judgements.

To demonstrate prerequisite gating:

```sh
npm run score -- --mock-answers fixtures/prerequisite-fails.json
```

This deliberately exits 1: the first score is `0.2`, below the declared
`[0.8, 1]` range. Both dependent projects are skipped and make no Jev calls.
Use `--mock-answers /path/to/answers.json` for other canned responses.

For a real call, authenticate your existing **host** `pass-cli` in a dedicated
agent session first, then run:

```sh
npm run score -- --backend real --secret-ref pass://vault/item/TYPESAFE_API_KEY
```

`score.mjs` sets the fixed purpose `goal=jev-playwright-v0; action=jev-score`
plus the run and question IDs before invoking host `pass-cli run -- …`.
It preserves `PROTON_PASS_SESSION_DIR` when provided. It neither installs
`pass-cli` nor logs in or modifies your session. Real scoring requires a
`pass://` reference and never silently falls back to mocks.

Audit the agent session separately with `pass-cli agent monitor --output json`.
The reason correlates secret access with the local run; it is not goal-based
access enforcement. Expected scores are never included in Jev requests.

## Run the whole harness in Dagger

```sh
npm run dagger
npm run dagger -- --backend real --secret-ref pass://vault/item/TYPESAFE_API_KEY
npm run dagger -- --mock-answers fixtures/prerequisite-fails.json
```

The Dagger module owns the entire execution:

```text
Dagger Run
  → container: Pkl evaluates the question graph
  → Playwright runs its dependent projects
      → collect evidence → local Jev client → assert score
  → reporter writes the native JSON report and score ledger
  → Pkl reconciles expected and observed ledgers
  → export report, including failures
```

Playwright never invokes Dagger. The HTTP fixture, Pkl CLI, Playwright runner,
Jev client, and reconciliation all execute inside the container. The example
uses Playwright's HTTP client, so it needs no browser binaries. Dagger installs
Node, Python, Pkl, and the pinned package dependencies. It does not install
pass-cli or import your host session. The host needs Dagger; live runs also
need your authenticated host pass-cli. `npm run dagger` itself needs Node,
but does not need host Python, Pkl, or installed npm dependencies.

For live runs, the small host launcher calls the module's `reason(runId)`
function first, then sets `PROTON_PASS_AGENT_REASON` before `pass-cli run`
resolves the API key. That process launches **one Dagger run for the entire
experiment** and passes the key as a Dagger Secret. The module sets the same
fixed run-level reason inside the container. Secret access is audited once
per run; individual question IDs remain in the scoring ledger. Each question's
`invocation.json` distinguishes its local `reason` from `credentialReason`.

`dagger/.env.example` shows the optional `RUN_TOKEN=env://TYPESAFE_API_KEY`
argument binding next to `dagger.json`. The launcher passes this binding
explicitly and does not edit your `.env`. A function cannot retroactively set
the reason for a secret resolved before that function starts; the separate
`reason` call handles that ordering. These defaults and audit reasons are not
access-control enforcement.

You can also call the module directly from the repository root:

```sh
dagger -m jev-playwright/dagger call run \
  --harness jev-playwright --client src/jev --run-id "$(uuidgen)" \
  artifacts export --path /tmp/jev-report
```

Replace `artifacts export --path /tmp/jev-report` with `check` to make the
Dagger call fail when the experiment fails. Export deliberately remains
available for failed experiments; `exit-code.json` records their status.
The npm launcher exports first, then exits with that recorded status.
Use a fresh run ID for a new experiment: it is a Dagger cache input, so an
identical invocation may reuse the earlier result.

## Artifacts

Each invocation creates `runs/<uuid>/` containing:

- `index.html`: standalone diagnostics viewer with snapshot navigation, recorded
  policy/HTTP comparisons, and selectable evaluations with scores, expectations,
  dependencies, and evidence links. Open directly in a browser. Snapshot labels
  come from collected evidence; they do not imply recorded Git commit identities.
- `report-expected.json`: evaluated Pkl contract used for this execution.
- `playwright-report.json`: native report, including evidence attachments.
- `questions/<id>/`: state, questions, exact Jev request, raw response, and result.
- `scores.json`: reporter ledger, including backend, model, and access reason.
- `report-observed.json`: scores joined with executions from the native report.
- `comparison.json`: Pkl coverage, execution, and expectation results.

The ledgers and native report share a run ID and SHA-256 contract digest.
Raw responses survive Jev contract failures. Setup or malformed-report errors
are written to `validation-error.txt` if a comparison cannot be produced.
Generated artifacts are ignored by Git; evidence may contain sensitive data.
The HTML embeds evidence too, so keep it with the same audience as the JSON.
To add the UI to an existing run: `node report-ui.mjs runs/<uuid>`.

Add questions and dependencies in Pkl and implement referenced collectors in
`collectors.ts`. The shared test registers each question; project filters
select exactly one question per project. The contract is evaluated once per
command, before test registration. This v0 uses no retries or sharding;
duplicate executions fail the final comparison. `npm test` is the complete
entry point—calling Playwright directly omits the final ledger comparison.
