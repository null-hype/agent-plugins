A status update should have reached user 10, but it did not. This recorded
Follower Maze case processes events as they arrive: `4,2,3,1`.

Select **Solve** to reveal the recorded reply. In the **Client** pane, click
**`fm-missing-delivery`** above the marked line to open its evidence.

The evidence opens inside the editor. Under `witness/arrival-order`, the
diagnostic records the difference:

- **Expected:** user 10 receives sequence 2 (`10 <- seq 2`).
- **Actual:** that delivery is missing (`-- missing --`).

The diagnostic and its explanation stay together: you can see what failed
without leaving the exchange.

**This is a recorded result.** A deterministic checker produced the reply during
a captured client/agent exchange. Solve replays that reply; it does not run a
new check. The evidence pane shows the diagnostic's recorded explanation.

Use **Reset** to return to the pending reply, or **Next** to check a repair
against the same case.
