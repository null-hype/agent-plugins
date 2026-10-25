# AGENTS.md — jev-playwright

This directory runs a question graph. `report-expected.pcf` says what should
happen, collectors gather what did, Jev scores it, and `pkl/Reconcile.pkl`
compares the two. The repository's review principles in `../AGENTS.md` apply
here.

An agent working here has exactly one role. If you were not told yours, ask.

## preregister

Write the `.pcf`: questions, judge instructions, expected ranges and
dependencies. Nothing else.

It counts as preregistered once the maintainer has accepted it and its contract
digest is stored in Proton Pass, before any run. From then on it is fixed; a
change is a new `.pcf`, preregistered again.

## plan

Write the collectors in `collectors.ts` that the `.pcf` names. Read the `.pcf`;
leave it unchanged. Expected ranges never leave the contract.

## apply

Run the graph. A collector that hands work to Jules fetches the Jules key from
Pass once per dispatch, under that dispatch's reason. Run without a repository
first, then against the real one, with the same `.pcf`.

## reconcile

Not an agent role. `npm test`, or the Dagger module's `check`, reconciles the
run against the `.pcf`.

## Reasons

Set `PROTON_PASS_AGENT_REASON` before a secret is resolved, as one plain
sentence saying what the access is for, e.g. "ask Jules to add an owner check to
the document route".
