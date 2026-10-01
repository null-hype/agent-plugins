# Jev question graph — document ownership fix

`report-expected.pcf` defines the question set, Jev instructions, evidence
collectors, required evidence, dependencies, model, and expected probability ranges.
Pkl rejects unknown dependency IDs and cycles before execution.
`playwright.config.ts` evaluates it using the local Pkl CLI adapter and saves
one JSON snapshot for the tests and reporter. No npm Pkl binding is assumed.

The config generates one Playwright project per question, with native project
dependencies. Each test gathers HTTP evidence, asserts the deterministic
behavior, invokes the existing `src/jev/jev` client, and asserts its score range
**before the project completes**. Failed prerequisites skip dependent projects
before evidence collection or scoring. The reporter only records results.

`run.mjs` ingests Playwright's JSON report and uses `pkl/Reconcile.pkl` to
validate node coverage, dependency order, score ranges, and dependency skips.
A valid low score is recorded as `expectation-failed`; a missing/invalid score
or evidence failure is `execution-failed`. Skipped dependents record
`dependency-skipped` and `blockedBy`. The command fails if any node is not
accepted, even when the graph correctly respected its dependencies.

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
`pass://` reference and never silently falls back to mocks. This v0 runs on
the host; the Dagger wrapper is deferred.

Audit the agent session separately with `pass-cli agent monitor --output json`.
The reason correlates secret access with the local run; it is not goal-based
access enforcement. Expected scores are never included in Jev requests.

## Artifacts

Each invocation creates `runs/<uuid>/` containing:

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

Add questions and dependencies in Pkl and implement referenced collectors in
`collectors.ts`. The shared test registers each question; project filters
select exactly one question per project. The contract is evaluated once per
command, before test registration. This v0 uses no retries or sharding;
duplicate executions fail the final comparison. `npm test` is the complete
entry point—calling Playwright directly omits the final ledger comparison.
