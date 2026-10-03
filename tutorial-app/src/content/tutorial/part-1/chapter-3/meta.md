---
type: chapter
title: CI Evidence & Capability Decisions
---

This chapter moves from a recorded CI export to capability decisions and
checks across requests, grants, and observations.

1. **Evidence.** Inspect a recorded CI run and its backup snapshots. Keep the
   scenario's recorded verdict separate from the CI job's result.
2. **Fix the declaration, then acquire the capability.** Correct a stale
   declaration, then record a supervisor decision in the browser fixture.
   Inventory and approval fail for different reasons.
3. **When the supervisor says no.** Inspect a rejected request. Refreshing
   observed state cannot create a grant the supervisor never approved.
4. **A recognized reason still needs a grant.** Check reason strings from
   repository scripts against a vocabulary and scoped approval records.
5. **Repair the disagreement, preserve the evidence.** Compare a worker
   request, stated reason, grant, and observed operation. Choose the repair
   without changing the observation just to make the check pass.
6. **Two passing changes, one failing rule.** Inspect two candidates that pass
   separately, merge cleanly, and fail together.

The browser exercises use TypeScript evaluators and fixtures derived from the
repository's Pkl examples. Each lesson explains what was recorded, what is
replayed, and what its check establishes.
