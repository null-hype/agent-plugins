# Canonical "aha" scenario (CIT-161)

> **Status: FROZEN for launch.** The canonical scenario is the Budget Authority walkthrough. Its composition witness is a synthetic spending-policy example; supervisor enforcement is simulated.

Two agents add costs to the same initially empty proposal: airfare 890 and ground travel 400. Each branch passes the same budget rule, `limit-v1` (1200). Git merges their non-overlapping files with zero conflicts. Evaluating the merged proposal with that same rule fails: 1290 > 1200. The replay represents a supervisor exception to v2 (1300), scoped to Proposal P, then shows `PASS @ v2` beside the retained `FAIL @ v1`.

| World read from Git | Total | Rule | Verdict |
|---|---:|---|---|
| Base | 0 | v1, limit 1200 | PASS |
| Base + airfare | 890 | v1, limit 1200 | PASS |
| Base + ground | 400 | v1, limit 1200 | PASS |
| Airfare + ground, clean merge | 1290 | v1, limit 1200 | FAIL |

[`merge.ts`](../../tutorial-app/tests/budget-authority/merge.ts) creates real commits and reads their file contents. [`merge.spec.ts`](../../tutorial-app/tests/budget-authority/merge.spec.ts) verifies their common ancestor, merge parents, retained facts, and the invariant matrix. One frozen rule and evaluator are used for every world, outside the branch checkouts.

```bash
cd tutorial-app
npm ci
npm test -- tests/budget-authority/merge.spec.ts src/lib/budgetAuthorityStoryboard.spec.ts
```

Expected: base/A/B pass, A+B fails under v1; the replay retains the failing v1 verdict beside the passing v2 verdict. The Git merge and all budget evaluations are computed. Jev's answer, the supervisor identity/grant, and turn progression are scripted. This does not show a live approval gate, a real authorization exploit, passing lint checks, or tamper-resistant history.

Interactive replay: [Budget Authority](https://null-hype.tidelands.dev/part-3/proposal-p-against-the-budget/1-jev-types-the-answer). Use Solve to reveal a recorded turn and the next arrow to continue.
