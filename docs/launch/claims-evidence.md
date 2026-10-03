# Claim → executable evidence (CIT-162)

Each row: claim, source, exact command, expected result, and what the result
does **not** establish. Authoritative engineering work lives in CIT-103, CIT-147,
and CIT-256; this table links directly to inspectable code and tests. Commands run
from repository root unless specified. Expected results describe the checks, not a blanket claim that every subsystem was rerun in the latest launch audit.

| # | Claim | Source (link) | Command | Expected result | Does not establish |
|---|---|---|---|---|---|
| 1 | Each branch can pass the same rule while their clean merge fails it | [`merge.ts`](../../tutorial-app/tests/budget-authority/merge.ts), [`merge.spec.ts`](../../tutorial-app/tests/budget-authority/merge.spec.ts) | `cd tutorial-app && npm test -- tests/budget-authority/merge.spec.ts` | Base 0 PASS; airfare 890 PASS; ground 400 PASS; merge 1290 FAIL; all under v1 limit 1200; zero Git conflicts | Synthetic spending policy, not a reproduced authorization vulnerability or unconstrained agent discovery |
| 2 | The replay retains a prior violation beside a scoped exception | [`budgetAuthorityStoryboard.spec.ts`](../../tutorial-app/src/lib/budgetAuthorityStoryboard.spec.ts) | `cd tutorial-app && npm test -- src/lib/budgetAuthorityStoryboard.spec.ts` | `PASS @ v2` alongside `FAIL @ v1`, both naming their rule and proposal | Simulated authority enforcement; retained records do not prove append-only storage or tamper resistance |
| 3 | A green test can be governed by nothing | [`bypassed_gate.pkl`](../../capability-spike/worker/fixtures_invalid/bypassed_gate.pkl) | `cd capability-spike && pkl test worker/fixtures_invalid/bypassed_gate.pkl` | `the truth is out there ✅` | That any real agent does this; the fixture is synthetic |
| 4 | Reconciliation flags that bypass pre-acceptance | [`reconcile/reconcile.go`](../../capability-spike/reconcile/reconcile.go), [`Reconcile.test.pkl`](../../capability-spike/pkl/Reconcile.test.pkl) | `cd capability-spike && pkl test pkl/Inventory.test.pkl pkl/Reconcile.test.pkl` | Every test line ends `✅`, including "a fact file that passes `pkl test` while never calling the gate is flagged anyway" | **Runtime enforcement.** Text search for `Ledger.checkAccess(` in fact file; proves static absence of gate call, not runtime execution |
| 5 | Fact, grant and observation can be checked against one another | [`Reconcile.pkl`](../../capability-spike/pkl/Reconcile.pkl), [`demo.go`](../../capability-spike/demo.go) | `cd capability-spike && go run .` | Steps 1-9 print; step 8 `reconciliation: aligned, no flags`; step 9 lists four flags; ends `demo: OK` | Real vaults. The Proton Pass step writes a local JSONL file only ([`runtime/proton.go`](../../capability-spike/runtime/proton.go)) |
| 6 | Rejections carry a typed, inspectable reason | [`Ledger.pkl`](../../capability-spike/pkl/Ledger.pkl), [`diagnostic/diagnostic.go`](../../capability-spike/diagnostic/diagnostic.go) | `cd capability-spike && go test ./...` | `ok dagger/capability-spike` | Exhaustive enumeration of error modes |
| 7 | Diagnostics render in an editor with their evidence | [`governanceDiagnostic.ts`](../../tutorial-app/src/lib/governanceDiagnostic.ts) | `cd tutorial-app && npm test` | All vitest suites pass | A production LSP server; this is a TutorialKit/Monaco interactive preview |
| 8 | Lessons are built from real CI evidence | [`tk-evidence-exporter/`](../../tk-evidence-exporter/README.md) (CIT-147) | see its README | see its README | More than one exported run (restic-backup 35172465388) |

Rows 1–2 and the TutorialKit/Vitest suite are rerun by the launch workflow. Rows 3–8 retain the existing subsystem evidence and commands; their results are not re-certified by a browser smoke test. See [`publication-status.md`](publication-status.md) for branch versus public verification.

## Not claimed

No production SaaS deployment, no measured vulnerability detection rate across unconstrained agent swarms, no claim that clean Git merges guarantee semantic safety. Scenarios are either computed on synthetic fixtures or exported from this project's own CI runs.

