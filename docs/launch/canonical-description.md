# Canonical description (CIT-157)

> **Status: FROZEN for launch.** Every surface (README, landing page, meta tags, LinkedIn, outreach) reuses this text verbatim. Any future change to the proposition must be made here first.

## Two sentences

Agent capabilities and automated changes can merge cleanly and pass tests while violating the business and security rules they seem to satisfy. This project turns capability governance into inspectable, typed checks that evaluate proposals before acceptance, flag policy violations with their underlying evidence, and record human supervisor exceptions without overwriting audit history.

## Fifteen seconds, spoken

"An agent's changes can merge cleanly and go green without the rules actually being satisfied. We make agent decisions reviewable with inspectable checks and immutable evidence instead of blind trust in a green build."

## Technical paragraph

Governance rules are expressed as declarative policy checks and Pkl axioms evaluated against immutable facts that an agent cannot edit to force a pass. In the Budget Authority walkthrough, two independently acceptable branches merge with zero textual conflicts, but fail semantic evaluation (`FAIL @ v1`) because the combined travel cost exceeds policy ($1,290 vs $1,200). When a supervisor grants an exception, rule version `v2` is pinned specifically to that proposal, producing `PASS @ v2` while retaining the original `FAIL @ v1` on the audit trail. In the capability engine, reconciliation checks compare declared inventory, agent-stated reasons, supervisor grants, and observed operations, generating typed `GovernanceDiagnostic` annotations for any unapproved or bypassed access. Scope & limitations: research prototype evaluated on synthetic and CI-exported scenarios; turn sequences are scripted with computed git merges and budget evaluations; the approval boundary is simulated. See [`claims-evidence.md`](claims-evidence.md).

## Vocabulary note

Primary terms: **capability**, **approval**, **evidence**, **rule version**.
Secondary, introduced progressively: axioms, facts, evaluations, supervisor protocol, reconciliation, `GovernanceDiagnostic`, pre-merge composition.

