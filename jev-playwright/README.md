# Jev question tests — v0

`report-expected.pcf` defines the question set, Jev instructions, evidence
collectors, required evidence, model, and expected probability ranges.
`playwright.config.ts` evaluates it using the local Pkl CLI adapter and saves
one JSON snapshot for the tests and reporter. No npm Pkl binding is assumed.

The tests gather evidence. The reporter invokes the existing `src/jev/jev`
client, then `run.mjs` ingests Playwright's JSON report and uses
`pkl/Reconcile.pkl` to validate the observed ledger against the snapshot.
The final command exits nonzero for execution or expectation failures.
Playwright's individual test statuses describe evidence collection; the final
comparison describes the scored experiment.

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

No browser or credentials are needed for the included fixed evidence collector.
The mock score of `0.9` comes from `fixtures/answers.json`; it is not a Jev
judgement. Use `--mock-answers /path/to/answers.json` to supply another canned
response. For example, a score of `0.2` fails the declared `[0.75, 1]` range.

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

Add questions in Pkl and implement referenced collectors in
`tests/questions.spec.ts`. The contract is evaluated once per command, before
test registration. This v0 uses one project and no retries or sharding;
duplicate executions fail the final comparison. `npm test` is the complete
entry point—calling Playwright directly omits the final ledger comparison.
