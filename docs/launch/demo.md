# Two-minute demo: green test, missing approval, diagnostic, repair

Needs [`pkl`](https://pkl-lang.org) and Go. No credentials, no network. All
commands run from [`capability-spike/`](../../capability-spike/README.md).
Outputs below were captured from this repository at the commit that added
this file.

## 1. The test is green

A worker's fact file asserts it was granted vault access. It never asks the
gate:
[`worker/fixtures_invalid/bypassed_gate.pkl`](../../capability-spike/worker/fixtures_invalid/bypassed_gate.pkl)
hardcodes `true`.

```bash
pkl test worker/fixtures_invalid/bypassed_gate.pkl
```

```
  the truth is out there ✅
```

A merge check that runs the tests accepts this.

## 2. The approval it implies does not exist

The honest version of that fact routes through the supervisor's gate,
`Ledger.checkAccess(factID, vault)`
([`pkl/Ledger.pkl`](../../capability-spike/pkl/Ledger.pkl)). Run the full
demo and read steps 1 and 9:

```bash
go run .
```

```
=== 1. Worker fact starts red ===
red: pkl test failed as expected
diagnostic: severity=error code=CAP_NO_GRANT factID=flight-booking:area51:vault-access vault=thepentagon.com message="no grant has been recorded for this fact -- request pending supervisor review"
```

Without a grant, the gated fact is red. The bypassing fact in step 1 never
got that answer.

## 3. The diagnostic

Reconciliation compares the worker's fact, the supervisor's grants and what
was observed. Step 9 of the same run:

```
flagged: boundary-bypassed fact=flight-booking:area51:vault-access: worker/fixtures_invalid/bypassed_gate.pkl does not call Ledger.checkAccess -- any green result did not go through the supervisor boundary
```

The flag names the file, the rule and the fact. **Limit:** this flag is a
text search for `Ledger.checkAccess(` in the fact file. It shows the fact
never asks the gate. It does not prove the gate ran at runtime, and a file
that mentions the call in a comment would satisfy it.

## 4. The repair

Put the gate call back. The fact is red until the supervisor approves
(step 1 above), then green with the fact file unchanged (steps 3-4 of the
same run). The boundary flag clears without touching any grant:

```bash
pkl test pkl/Reconcile.test.pkl
```

```
  a fact file that passes `pkl test` while never calling the gate is flagged anyway ✅
  restoring the gate call clears the boundary flag without changing any grant ✅
```

## Same demo, in the editor

The interactive version renders this diagnostic as a hover in the tutorial
app: chapter 3, lesson 5, "The wrong-way peninsula". The lesson opens with
background before the failure; use this page first, then the lesson for the
depth. See [`tutorial-app/`](../../tutorial-app/).

## What this does not show

Two independently acceptable changes becoming unsafe together. No fixture
here contains an A-alone / B-alone / A+B composition. See the open item in
[`aha-scenario.md`](aha-scenario.md).
