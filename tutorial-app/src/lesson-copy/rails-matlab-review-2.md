Pull request #118 answers the first review. Its description says the independent
read evidence now reaches the checker, and that deleting the trace, or forging a
dummy-file read into the blocked arm, "is now flagged". The editor holds the
commit that change was written as.

The two questions are the ones asked of #117, word for word. Toggle **solved** to
ask the reviewer, then take either suggestion with **Tab** (or **Alt+]** to switch
first), or both.

Click the lens above an accepted line, **`review-2.finding-1.deleted-trace`** or
**`review-2.finding-1.forged-read`**, to open the evidence behind it. The
**reproduction** row is the probe run again, for real, against the checker as #118
submitted it. It is a new run, not the reviewer's own output, which was not kept.
It shows the checker still passing all 56 assertions. The new tests change the
derived open count; neither probe touches that count, because both change the
retained trace.
