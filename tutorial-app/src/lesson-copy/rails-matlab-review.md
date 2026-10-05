The check in pull request #117 passed. The editor on the left holds the commit
that change was written as, in the form this case gives every change: a message
whose subject line is a question. Unfold it to read the body.

Toggle **solved** to ask the reviewer. Its answer appears below the commit as
grey suggested lines: the questions it asked itself to split yours, one by
deleting the trace and one by forging a read. Press **Tab** to accept the one
shown, or **Alt+]** to switch to the other first. You can take either, or both.
Each accepted line becomes text in your editor, and each is checked.

Click the lens above an accepted line, **`review-1.finding-1.deleted-trace`** or
**`review-1.finding-1.forged-read`**, to open the evidence behind it: the
review's own account of what the checker still accepted, the line of the checker
that never reads the trace (`Reconcile.pkl`), and the trace nobody read. One
row is the part nobody kept: the output of the review's own test run. Next to it
is a **reproduction**: the same probe run again, for real, against the checker as
submitted. It is a new run, not the reviewers' output, and it shows the checker
still passing all 28 assertions.

On **`review-1.finding-1.forged-read`**, the `Reconcile.pkl` row has an **Open
captured file** control. It opens the checker as review 1 read it, at the commit
the review cited, with the line the row points at marked: the checker's `check`
function, which takes a claim and an observation and nothing else. This lesson
opens that one row's file so far. The other rows are summary text here, and the
one marked *not retained* is the only part nobody kept.
