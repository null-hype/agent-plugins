# capability-spike (CIT-139)

Smallest proof that fact-driven capability acquisition can reuse a
typed Pkl/Go compiler-diagnostic architecture (per
[null-hype/codespaces-blank](https://github.com/null-hype/codespaces-blank)'s
`compiler.Diagnostic{severity, code, message}` model) for agent access
governance, with reconciliation against a Proton Pass reason.

## Run it

```
go run .
```

Prints a transcript of: worker fact starts red -> supervisor approves via
governed state (not by editing the fact) -> the *same, unmodified* fact
turns green -> a Proton Pass operation is recorded keyed by the fact's
stable ID -> a reconciliation pass confirms fact/approval/Proton agree ->
a second, deliberately misaligned pass shows the check catching drift.

`go test ./...` covers the same path plus the individual negative
fixtures under `worker/fixtures_invalid/`.

## Ownership boundary

- `worker/*.pkl` -- worker-owned. A `pkl:test` fact requesting a
  capability by calling `Ledger.checkAccess(factID, vault)`. Never edited
  to make a request pass.
- `pkl/Ledger.pkl` -- supervisor-owned gate. `throw()`s a structured
  `CAP_*` diagnostic on rejection; pkl:test's `facts{}` can't catch a
  thrown error internally (see `worker/eval.go`'s doc comment and CIT-96's
  prior art), so `worker.Run` drives `pkl test` as a subprocess and
  `diagnostic.Parse` extracts the structured code/message from stderr.
- `pkl/GrantState.pkl` -- supervisor-owned approval ledger, the only Pkl
  file `supervisor.Decide` (Go) ever writes. Loaded back via the real
  pkl-go bindings (`pkl.NewEvaluator` + `EvaluateModule`), not by
  re-reading Go-side copies.
- `runtime/proton.go` -- observed/materialized evidence: what Proton
  operation was actually recorded, keyed by the same stable fact ID
  (`PROTON_PASS_AGENT_REASON`). Records to a local JSONL ledger only; does
  not call `pass-cli` or touch a real vault (this is a spike run in CI/a
  background job, not an integration with real Proton Pass state).
- `reconcile/reconcile.go` -- checks all three agree, and flags:
  1. `unapproved-materialization` -- observed with no matching grant
  2. `missing-materialization` -- approved but never observed
  3. `reason-mismatch` -- observed reason/vault doesn't match the grant
  4. `boundary-bypassed` -- a green fact file that never calls
     `Ledger.checkAccess` at all (static check on the fact's own text,
     since `pkl test`'s pass/fail can't tell approved-green from
     hardcoded-green)

No `hk.pkl` check wires this into `git push` -- it's a standalone spike,
run manually or from CI, not a repo-wide gate.
