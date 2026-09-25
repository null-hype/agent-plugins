# Canonical Demo: 60–120 Second Walkthrough (CIT-160)

The canonical demonstration can be experienced interactively in the browser at
[`null-hype.tidelands.dev`](https://null-hype.tidelands.dev/part-3/proposal-p-against-the-budget/1-jev-types-the-answer)
or replayed via Storybook (`npm run storybook` in `tutorial-app`).

## The 6-Step Canonical Demo Narrative

### 1. Apparently valid change
A worker agent generates Proposal P for an upcoming business trip, stating that the proposed travel itinerary fits well within travel policy limits.

### 2. Introduce the second change / branch
The proposal incorporates two distinct pull requests: a flight booking and a hotel reservation. Both branches pass syntax and linting checks.

### 3. Reveal the composition conflict
Git merges the two branches with zero conflicts (`clean · 0 conflicts`). But when the combined itinerary is evaluated against organizational policy, the total comes to **$1,290 against a hard policy cap of $1,200**. Ordinary git merge and test checks are completely blind to this semantic violation.

### 4. Show diagnostic / evidence
The governance layer intercepts the proposal pre-merge and emits a typed diagnostic: `FAIL @ v1`. Clicking the diagnostic reveals the exact calculation ($1,290 > $1,200), the proposal tree SHA, and the immutable rule version `v1`.

### 5. Reconcile it via scoped supervisor exception
A human supervisor reviews the operational context and grants a one-time budget exception ($1,200 → $1,300), scoped strictly to Proposal P.

### 6. End on the evidence trail
Re-evaluation produces `PASS @ v2` beside the unchanged `FAIL @ v1`. The original violation is never erased or overwritten; every verdict permanently records the exact rule version, the proposal tree, and the human supervisor identity.

---

## Fallback CLI Demo: Green test, missing approval, diagnostic, repair

Needs [`pkl`](https://pkl-lang.org) and Go. No credentials, no network. All commands run from [`capability-spike/`](../../capability-spike/README.md).

### 1. The test is green
A worker's fact file asserts it was granted vault access. It never asks the gate: [`worker/fixtures_invalid/bypassed_gate.pkl`](../../capability-spike/worker/fixtures_invalid/bypassed_gate.pkl) hardcodes `true`.

```bash
cd capability-spike && pkl test worker/fixtures_invalid/bypassed_gate.pkl
```
```
  the truth is out there ✅
```
A merge check that runs the tests accepts this.

### 2. The approval it implies does not exist
The honest version routes through `Ledger.checkAccess(factID, vault)`. Run `go run .`:
```
=== 1. Worker fact starts red ===
red: pkl test failed as expected
diagnostic: severity=error code=CAP_NO_GRANT factID=flight-booking:area51:vault-access vault=thepentagon.com message="no grant has been recorded for this fact -- request pending supervisor review"
```

### 3. The diagnostic
Reconciliation compares declared fact, supervisor grant, and observation:
```
flagged: boundary-bypassed fact=flight-booking:area51:vault-access: worker/fixtures_invalid/bypassed_gate.pkl does not call Ledger.checkAccess -- any green result did not go through the supervisor boundary
```

### 4. The repair
Restoring the gate call clears the boundary flag without altering the supervisor grant:
```bash
pkl test pkl/Reconcile.test.pkl
```
```
  a fact file that passes `pkl test` while never calling the gate is flagged anyway ✅
  restoring the gate call clears the boundary flag without changing any grant ✅
```

