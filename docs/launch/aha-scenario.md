# Canonical "aha" scenario (CIT-161)

> **Status: DRAFT for owner sign-off. First launch leads with the demonstrated reconciliation result, not composition.** Built from the existing
> `capability-spike` and TutorialKit chapter 3, lesson 5. It does not add mechanism.

## The story (no stack names)

A worker agent asks for access to a secret and gives a reason. Its test is
green. But the test never asked the gatekeeper: it hardcodes the pass, so the
approval the green seems to imply does not exist. A normal merge check sees a
green test and nothing else. The governance layer compares what the worker
declared, the reason the agent gave, what the supervisor granted, and what
actually happened. It flags the disagreement before the change is accepted and
shows the facts behind the flag. "Green, and governed by nothing." Walkthrough
with real output: [`demo.md`](demo.md).

## Required shape, and where each part lives

| Requirement (CIT-161) | Evidence |
|---|---|
| Change A acceptable alone | Not demonstrated (no A/B fixture) |
| Change B acceptable alone | Not demonstrated (no A/B fixture) |
| Composition changes a property that matters | Not demonstrated; nearest: unapproved or missing materialization |
| Ordinary checks miss it | `bypassed_gate.pkl` passes `pkl test` |
| Governance flags it pre-acceptance | `capability-spike/pkl/Reconcile.pkl` (`boundary-bypassed`) |
| Diagnostic makes reasons inspectable | `tutorial-app/src/lib/governanceDiagnostic.ts`, chapter 3 lessons 4-5 |

Run: `cd capability-spike && pkl test pkl/Inventory.test.pkl pkl/Reconcile.test.pkl`

## Open item

CIT-161 asks for a "two-world" composition example. The current material
shows a fact vs. grant vs. observation disagreement, not two independently
valid changes conflicting. Launch copy no longer claims composition. Adding a two-branch A/B/A+B
fixture is the follow-up that would let it be claimed.
