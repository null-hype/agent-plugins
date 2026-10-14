# Rails evidence and replay scenarios

The installed feature supplies the Pkl ontology and experiment command.
Browser specs, Pkl assertions, and accepted case evidence live in `test/`.

## Jev evidence

1. Run the manual global workflow with `securerandom-always-two` or
   `yjit-always-available`. The scenario configuration selects the case and
   commit hash. The harness renders requests with Pkl and invokes the installed
   `jev` CLI.
2. Review the `rails-cases-captures` artifact: input commit and Vale alerts,
   exact Jev requests, raw answers, and joined recordings. A capture is a
   candidate, not an accepted fixture.
3. To accept, propose the corresponding changes to
   `test/rails-cases/<case>/commit.txt`, `vale.json`, and `recordings.json`
   in Git. Human review accepts or rejects that diff. There is no separate
   refresh command and no automatic overwrite of accepted evidence.

The committed recordings are currently empty. They are not valid captured
evidence: the replay checks must fail until a real capture is reviewed.
The request and probability checks remain required; no sample scores are
invented to make replay pass. Archiving agent sessions with restic remains
independent of accepting these fixtures.

## Browser evidence

After evidence is accepted, PR CI calls
`securerandom-always-two-har` and `yjit-always-available-har` in Dagger.
These render the frame using the installed Pkl modules, build Storybook,
and run this directory's browser spec against it. That live run creates
`replay.har` and `snapshots.json`; CI exports them into each case directory
and retains them as the `rails-browser-replays` artifact.

The local feature scenarios then run the same spec offline against that HAR.
Unmatched requests fail. The application frame path in Dagger is where
Storybook imports its generated data; accepted evidence stays under `test/`.

## Agent proposals

The role-local scenarios own their Pkl assertions. The global
`rails-experiment` scenario owns the claim/control expectations and supplies
its checks to the installed command with `--checks`. It produces candidate
`*-expected.pcf` files, diffs, and pending review records. Accepting an
expectation is a human-reviewed Git change; passing the composition test
does not accept it.
