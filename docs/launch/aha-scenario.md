# Canonical "aha" scenario (CIT-161)

> **Status: DRAFT for owner sign-off.** Built from the existing
> `capability-spike` and TutorialKit chapter 3, lesson 5. It does not add mechanism.

## The story (no stack names)

A worker agent asks for access to a secret and gives a reason. Reviewed alone,
the request is fine: the test for it is green. A second change, reviewed alone,
is fine too. Together they leave a state nobody approved. The worker's test
passes without ever asking the gatekeeper, so the pass is real, and the
approval it seems to imply does not exist. A normal merge check sees a green
test and nothing else. The governance layer compares four accounts of the
same event: what the worker declared, the reason the agent gave, what the
supervisor granted, and what actually happened. It flags the disagreement
before the change is accepted and shows the exact facts behind the flag.
"Green, and governed by nothing."

## Required shape, and where each part lives

| Requirement (CIT-161) | Evidence |
|---|---|
| Change A acceptable alone | `capability-spike/worker/*.pkl` (approved fact goes green) |
| Change B acceptable alone | same, the supervisor-approved path |
| Composition changes a property that matters | unapproved or missing materialization |
| Ordinary checks miss it | `bypassed_gate.pkl` passes `pkl test` |
| Governance flags it pre-acceptance | `capability-spike/pkl/Reconcile.pkl` (`boundary-bypassed`) |
| Diagnostic makes reasons inspectable | `tutorial-app/src/lib/governanceDiagnostic.ts`, chapter 3 lessons 4-5 |

Run: `cd capability-spike && pkl test pkl/Inventory.test.pkl pkl/Reconcile.test.pkl`

## Open item

CIT-161 asks for a "two-world" composition example. The current material
shows a fact vs. grant vs. observation disagreement, not two independently
valid changes conflicting. Decide whether this scenario is close enough, or
whether a two-branch fixture should be added.
