# Canonical description (CIT-157)

> **Status: DRAFT for owner sign-off.** Once approved, every surface (README,
> landing page, meta tags, LinkedIn, outreach) reuses this text verbatim. A change
> to the proposition is made here first, on purpose.

## Two sentences

Agent capabilities (MCP servers, skills, plugins, connectors) can each be
acceptable on their own and still be unsafe once composed, and ordinary merge
checks and green tests do not show it. This project turns capability
governance into executable, typed checks that flag the conflict, and the
reasons and facts behind it, before a capability is accepted.

## Fifteen seconds, spoken

"Two agent capabilities can each pass review and still conflict once you
combine them. We make that conflict a failing check you can read, with the
evidence behind it, instead of a green build that governs nothing."

## Technical paragraph

Governance rules are stated as Pkl axioms (declared vs. observed inventory,
supervisor-owned grants, a governed vocabulary for agent-stated reasons) and
evaluated against facts a worker cannot edit to make a request pass. A
verdict is a typed `GovernanceDiagnostic` carrying the fact, grant,
observation and axiom it was computed from, so it renders as an editor
hover or CodeLens. A reconciliation axiom checks that the worker's fact, the
agent's stated reason, the supervisor's grant and what actually
materialized agree, and flags a green test that never called the gate.
Status: research prototype on synthetic and CI-exported scenarios, not a
production control. See [`claims-evidence.md`](claims-evidence.md).

## Vocabulary note

Primary terms: **capability**, **composition**, **evidence**.
Secondary, introduced progressively, never in the opening screen: axioms,
facts, evaluations, conflicting worlds, supervisor protocol, reconciliation,
`GovernanceDiagnostic`, MCP/skills/plugin governance, pre-merge composition.
