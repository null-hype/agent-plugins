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
- `pkl/Reconcile.pkl` -- the same alignment invariant stated as a Pkl
  function instead of only as Go, so it can be exercised with no Go
  toolchain, no Proton Pass credentials and no state on disk. It takes
  the grants, observations and fact-file sources it reconciles as
  arguments (it deliberately does not import the git-ignored
  `GrantState.pkl`), which is what makes `pkl test
  pkl/Reconcile.test.pkl` a one-command check.

## Running just the axioms

```
pkl test pkl/Inventory.test.pkl pkl/Reconcile.test.pkl
```

Credential-free and state-free -- no `go run .` first, no
`pkl/GrantState.pkl` on disk. `Reconcile.test.pkl` pins every flag's
diagnostic text against `Reconcile.test.pkl-expected.pcf` in its
`examples {}` block: the `facts {}` block checks that the right flag
fires, the golden file checks that the message a supervisor has to act on
is still worth acting on.

Wired as an `hk check` step (`capability-axioms`) so it runs in the same
local pass as this repo's other Pkl contracts. It is not in `pre-push`:
nothing here gates `git push`, and the rest of the spike (`go run .`,
`go test ./...`, which need a Go toolchain and rewrite
`pkl/GrantState.pkl`) still runs manually or from CI, not as a repo-wide
gate.

## Where this is taught

`null-hype.github.io`'s TutorialKit chapter 3, lesson 5 ("The wrong-way
peninsula", CIT-150) is built on this directory: it replays
`reconcile.Check` in TypeScript against these exact fixtures and asks the
reader to decide, for each flag, whether the fact, the agent's stated
reason, or the axiom itself is what's wrong. `bypassed_gate.pkl` and
`TestBypassedGatePassesPklTestButFlaggedByReconciliation` are that
lesson's central exhibit -- a fact whose test is green and whose frame is
wrong.
No `hk.pkl` check wires this into `git push` -- it's a standalone spike,
run manually or from CI, not a repo-wide gate.

## Reason resolver (CIT-149)

`pkl/GovernedVocabulary.pkl` and `resolver/` extend the above from "may
this fact acquire the capability" to "does this fact's stated reason even
name something the supervisor recognizes" -- turning a raw
`PROTON_PASS_AGENT_REASON` string (real prose the `color` bin in
`src/pass-cli/install.sh` already emits, not an invented token) into a
`Diagnostic`.

- `pkl/GovernedVocabulary.pkl` -- supervisor-owned, modelled on
  tutorial-app's chapter-1 lesson-2 `PersonalVocabulary.pkl` with
  ownership inverted: a worker fact may reference an admitted `phrase`,
  never add one. Each entry names a `scope` (the reason's AGENT_ASSIGNMENT
  prefix) alongside the `factId` it maps to.
- `resolver.Resolve(raw, vocab, grantsByFactID)` -- maps `raw` against the
  vocabulary, then only for an admitted phrase checks the result against
  `pkl/Ledger.pkl`'s own three codes (`CAP_NO_GRANT`, `CAP_REJECTED`,
  `CAP_VAULT_MISMATCH`), mirrored in Go rather than driven through
  `pkl test` so a resolved-but-denied fact still reports its `factID`
  instead of losing that distinction to a thrown error string. An
  unadmitted phrase gets the one new code this adds,
  `CAP_TERM_UNRESOLVED` -- deliberately distinct from `CAP_NO_GRANT`:
  admission is not access.
- `resolver/fixture.go` -- three real, verbatim reason strings lifted from
  `src/pass-cli/install.sh` (two real scenarios' worth), each exercising a
  different outcome: granted (clean), admitted-but-ungranted
  (`CAP_NO_GRANT`), and never-admitted (`CAP_TERM_UNRESOLVED`).
  `resolver/fixture_test.go` diffs the fixtures' prose and scope tags
  against `install.sh` and the relevant `test/_global/*/Dockerfile`s
  directly, so they cannot silently drift into invented strings.

The browser-side lesson at
[null-hype/null-hype.github.io](https://github.com/null-hype/null-hype.github.io)'s
`tutorial-app/src/content/tutorial/part-1/chapter-3/lesson-4` renders the
same fixtures' diagnostics as Monaco markers/hovers in the `otel-warm-log`
template, the same way chapter-3's lessons 2-3 replay `Ledger.pkl` and
`Inventory.pkl` in TypeScript because a browser lesson cannot reach a live
Pkl evaluator.
