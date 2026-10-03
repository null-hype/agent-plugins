# Canonical description (CIT-157)

> **Status: FROZEN for launch.** Every surface (README, landing page, meta tags, LinkedIn, outreach) reuses this text verbatim. Any future change to the proposition must be made here first.

## Two sentences

Automated changes can each pass the same policy check and still violate it when merged cleanly. This project makes agent proposals reviewable through typed checks, linked evidence, and recorded supervisor exceptions that preserve prior verdicts.

## Fifteen seconds, spoken

"Two changes pass the same rule separately, then fail it when merged. We make that failure inspectable and keep the original verdict visible when a supervisor grants an exception."

## Technical paragraph

The Budget Authority fixture creates two Git branches from one base, reads each commit's proposal facts, and evaluates base, airfare, ground, and their merge with the same evaluator and frozen v1 rule held outside those branches. The separate totals (890 and 400) pass the 1200 limit; their clean merge totals 1290 and fails. The scripted replay then represents a supervisor exception to v2 (1300) for Proposal P and retains both verdicts. In the separate capability engine, reconciliation compares declared inventory, agent-stated reasons, supervisor grants, and observed operations to produce typed diagnostics. Scope: this is a research prototype on synthetic fixtures and CI-exported examples. The budget example demonstrates composition of a spending rule, not a reproduced authorization vulnerability. Jev's answer, turn progression, and authority enforcement are simulated. Retaining prior verdicts does not establish tamper resistance or append-only storage. See [`claims-evidence.md`](claims-evidence.md).

## Vocabulary note

Primary terms: **capability**, **approval**, **evidence**, **rule version**.
Secondary, introduced progressively: axioms, facts, evaluations, supervisor protocol, reconciliation, `GovernanceDiagnostic`, pre-merge composition.

