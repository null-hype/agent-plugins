# Claim → executable evidence (CIT-162)

Each row is claim → scenario → source → run → artifact → known limit.
Authoritative evidence work lives in CIT-103 and CIT-147; this table links to
it rather than duplicating it. Rows marked TODO have no verified command yet.

| Claim | Scenario | Source | Run | Known limit |
|---|---|---|---|---|
| A green test can be governed by nothing | `bypassed_gate.pkl` | `capability-spike/worker/fixtures_invalid/` | `go test ./...` in `capability-spike` (`TestBypassedGatePassesPklTestButFlaggedByReconciliation`) | Static check on fact text; synthetic fixture |
| Approval, reason and materialization can be reconciled by one axiom | Fact/grant/observation agree, then a misaligned pass | `capability-spike/pkl/Reconcile.pkl` | `pkl test pkl/Inventory.test.pkl pkl/Reconcile.test.pkl` | Proton Pass step writes a local JSONL ledger only, no real vault |
| Rejections carry a typed, inspectable reason | `CAP_*` diagnostics | `capability-spike/pkl/Ledger.pkl`, `diagnostic/` | `go run .` in `capability-spike` | Parsed from `pkl test` stderr |
| Diagnostics render in an editor with their evidence | Monaco hover and CodeLens | `tutorial-app/src/lib/governanceDiagnostic.ts` | `cd tutorial-app && npm test` | TutorialKit preview, not a real language server (CIT-152 scope) |
| Lessons are built from real CI evidence | restic-backup run 35172465388 | `tk-evidence-exporter/` (CIT-147) | see its README | One run exported so far |
| Claims in the tutorial are traceable | chapter 3 lessons 1-5 | `tutorial-app/src/content/tutorial/part-1/chapter-3/` | `cd tutorial-app && npm run dev` | TODO: CIT-103 audit reconciliation pending |

## Not claimed

No production deployment, no measured detection rate, no evaluation against
real third-party MCP servers or plugins. Scenarios are synthetic or exported
from this project's own CI.
