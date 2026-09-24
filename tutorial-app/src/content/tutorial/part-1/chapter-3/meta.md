---
type: chapter
title: CI Evidence & Capability Decisions
---

This chapter leaves the language examples behind and works from real exported CI evidence and real capability-governance code, not scripted examples.

1. **Evidence.** Browse one real CI run and its backup snapshots, exported as a lesson. It keeps two verdicts apart: what the scenario recorded, and what the CI job reported.
2. **Fix the declaration, then acquire the capability.** Two checks, `Inventory.pkl`'s `missingItems()` (is what was declared actually there?) and `Ledger.pkl`'s `checkAccess()` (did the supervisor approve it?), fail for different reasons. You fix one by editing a declaration. The other needs a decision, which you make as the supervisor.
3. **When the supervisor says no.** The same two checks, for a rejected request. Refreshing state resolves nothing, because there was never a grant to act on.
4. **One true diagnostic on a real agent reason.** Real reason strings are checked against a supervisor-owned vocabulary before the access check runs. The result is a typed diagnostic, carrying its evidence, rendered in the editor.
5. **The wrong-way peninsula.** What is a passing check evidence *of*? This lesson reconciles four representations of one action: what the worker asked for, what the agent said, what the supervisor decided, and what actually happened. The key exhibit is a fact file that passes `pkl test` without ever calling the gate.
6. **Two passing changes, one failing rule.** Two candidates each pass, merge cleanly, and fail together.

Every check runs as a real, typed evaluation, and each lesson says what is real and what is replayed in the browser.
