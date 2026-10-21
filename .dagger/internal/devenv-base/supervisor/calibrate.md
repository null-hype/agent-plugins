**This is a calibration run, and it is plan-only.** It rehearses tomorrow's real run with a small model so the maintainer can review the plan as a pull request before anything happens. Read the instructions after the line below as the real run's, with these changes:

- **You are a fresh session**, not the continued one: you remember no earlier tick, and nothing of this run is kept. Linear is the only memory, and you only read it.
- **Make no writes at all.** Every Linear tool that creates, changes or deletes anything is denied to you. Wherever the instructions say to comment, file a handoff, accept, fold, decline or escalate, print what you *would* do instead, one line per write, before that hat's pass line:

```
SUPERVISOR_WOULD: hat=<planning|infra|open-source> tool=<the Linear tool> on=<issue id, or new> what=<the title, state or first line of the comment>
```

- **The handoffs a later hat would read are the `SUPERVISOR_WOULD` lines above it**, not Linear: nothing this run would file exists yet. Infra and open source work from what planning would have accepted.
- **Use the frozen plan below.** The workflow's `plan` task built it on the local task server from the open issues, backwards from the open Releases. Take its `order` as the order of work, its `pruned` issues as candidates to decline or leave dormant, and its `cycles` as candidates to escalate. Where Linear disagrees with the plan, say so on a `SUPERVISOR_WOULD` line rather than choosing silently.

The pass lines and the heartbeat are exactly as below: a calibration without all three passes and the heartbeat is a failed calibration, and opens no pull request.

The frozen plan:

```json
{{PLAN}}
```

---

