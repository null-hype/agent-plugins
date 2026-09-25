# Canonical "aha" scenario (CIT-161)

> **Status: FROZEN for launch.** The canonical launch scenario is the **Budget Authority walkthrough** (interactive in the tutorial and Storybook), supported by the **Capability Reconciliation engine** in `capability-spike`.

## The story (no stack names)

An agent proposes a travel itinerary incorporating two separate changes: a flight booking and a hotel reservation. Each branch is valid on its own, and git merges them with zero textual or syntax conflicts. But when the composed proposal is evaluated against the organization's spending policy, the combined total is $1,290 against a budget cap of $1,200. Ordinary merge and lint checks pass, but the governance check flags the semantic violation (`FAIL @ v1`), linking the verdict directly to the calculation and rule version. When a supervisor reviews the failure and grants an explicit budget exception ($1,200 → $1,300) scoped strictly to Proposal P, re-evaluation produces `PASS @ v2` beside the original `FAIL @ v1`—preserving the permanent audit log of the failure and the human exception rather than overwriting history.

## Required shape, and where each part lives

| Requirement (CIT-161) | Evidence |
|---|---|
| Change A acceptable alone | Flight booking within individual tier limit |
| Change B acceptable alone | Hotel booking within individual tier limit |
| Composition changes a property that matters | Total ($1,290) exceeds budget threshold ($1,200) |
| Ordinary checks miss it | Git merges the two branches cleanly (`clean · 0 conflicts`) |
| Governance flags it pre-acceptance | Policy check evaluates `Proposal P` and issues `FAIL @ v1` |
| Diagnostic makes reasons inspectable | Diagnostic pins rule version (`v1`), proposal tree SHA, and exact numbers ($1,290 vs $1,200) |
| Reconciliation / Scoped Exception | Supervisor grants $1,200 → $1,300 exception for P only; check re-evaluates as `PASS @ v2` while retaining `FAIL @ v1` |

Interactive replay: [`null-hype.tidelands.dev/part-3/proposal-p-against-the-budget/1-jev-types-the-answer`](https://null-hype.tidelands.dev/part-3/proposal-p-against-the-budget/1-jev-types-the-answer) or Storybook `BudgetAuthority`.
Runnable specs: `cd tutorial-app && npm test tests/budget-authority/prose.ts`
Reconciliation engine: `cd capability-spike && go run .`

