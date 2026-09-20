# Claim → executable evidence (CIT-162)

Each row: claim, source, exact command, expected result, and what the result
does **not** establish. Authoritative engineering work lives in CIT-103 and
CIT-147; this table links to it rather than duplicating it. Commands run
from the directory named in the first bullet of the row. Expected results
were observed on this repository's current tree.

| # | Claim | Source (link) | Command | Expected result | Does not establish |
|---|---|---|---|---|---|
| 1 | A green test can be governed by nothing | [`bypassed_gate.pkl`](../../capability-spike/worker/fixtures_invalid/bypassed_gate.pkl) | `cd capability-spike && pkl test worker/fixtures_invalid/bypassed_gate.pkl` | `the truth is out there ✅` | That any real agent does this; the fixture is synthetic |
| 2 | Reconciliation flags that bypass | [`reconcile/reconcile.go`](../../capability-spike/reconcile/reconcile.go), [`Reconcile.test.pkl`](../../capability-spike/pkl/Reconcile.test.pkl) | `cd capability-spike && pkl test pkl/Inventory.test.pkl pkl/Reconcile.test.pkl` | every test line ends `✅`, including "a fact file that passes `pkl test` while never calling the gate is flagged anyway" | **Runtime enforcement.** The flag is a text search for `Ledger.checkAccess(` in the fact file (`reconcile.go` `strings.Contains`). It shows the fact never asks the gate; it does not show a gate ran, and a comment containing that text would satisfy it |
| 3 | Fact, grant and observation can be checked against one another | [`Reconcile.pkl`](../../capability-spike/pkl/Reconcile.pkl), [`demo.go`](../../capability-spike/demo.go) | `cd capability-spike && go run .` | Steps 1-9 print; step 8 `reconciliation: aligned, no flags`; step 9 lists four flags; ends `demo: OK` | Real vaults. The Proton Pass step writes a local JSONL file only ([`runtime/proton.go`](../../capability-spike/runtime/proton.go)) |
| 4 | Rejections carry a typed, inspectable reason | [`Ledger.pkl`](../../capability-spike/pkl/Ledger.pkl), [`diagnostic/diagnostic.go`](../../capability-spike/diagnostic/diagnostic.go) | `cd capability-spike && go test ./...` | `ok  dagger/capability-spike` | Completeness of codes; parsed from `pkl test` stderr |
| 5 | Diagnostics render in an editor with their evidence | [`governanceDiagnostic.ts`](../../tutorial-app/src/lib/governanceDiagnostic.ts) | `cd tutorial-app && npm install && npm test` | vitest reports all tests passing | A real language server; this is a TutorialKit preview (CIT-152 scope). Not re-run for this revision |
| 6 | Lessons are built from real CI evidence | [`tk-evidence-exporter/`](../../tk-evidence-exporter/README.md) (CIT-147) | see its README | see its README | More than one exported run (restic-backup 35172465388) |

Rows 1-4 were re-run for the CIT-175 revision. Row 5 was not re-run.

## Not claimed

No production deployment, no measured detection rate, no evaluation against
real third-party MCP servers or plugins, no A-alone / B-alone / A+B
composition fixture. Scenarios are synthetic or exported from this project's
own CI.
