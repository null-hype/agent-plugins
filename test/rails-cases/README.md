# Rails evidence and replay scenarios

For the complete YJIT capture → check → viewer example, see
[INTEGRATION.md](yjit-always-available/INTEGRATION.md). A fresh capture can be
checked and displayed directly, without translating its responses into Pkl.

The installed feature supplies the Pkl ontology and experiment command.
Browser specs, Pkl assertions, and captured case evidence live in `test/`.

The YJIT confidence experiment uses the ordinary local feature scenario; see
[yjit-always-available/EXPERIMENT.md](yjit-always-available/EXPERIMENT.md).
Its committed expectation can fail without any candidate or promotion step.
The browser-only YJIT replay is separately named `yjit-browser-replay`.

## Jev evidence

1. Run the manual global workflow with `securerandom-always-two` or
   `yjit-always-available`. The scenario configuration selects the case and
   commit hash. The harness renders requests with Pkl and invokes the installed
   `jev` CLI. The registered scenarios are named for the cases;
   `test/_global/rails-cases/capture.sh` is their shared helper, not a scenario.
2. Inspect the `rails-cases-captures` artifact: input commit and Vale alerts,
   exact Jev requests, raw responses, derived recordings, and viewer frame.
3. Pass the YJIT capture directory directly to the existing case script with
   `RAILS_CASE_EVIDENCE`, or to Dagger with `--evidence`. The outcome check and
   viewer consume it without conversion into committed Pkl literals. Updating
   a retained baseline or an expectation remains an explicit Git diff for
   review; running the capture/check never overwrites the expected PCF.

The YJIT `Fixtures.pkl` generates all static JSON from committed Pkl sources:
Vale alerts, sketch, initial snapshots, Jev requests, answers, responses,
provenance, and composed recordings. The scenario generates these into a fresh
temporary directory before assertions, preserving any browser-exported
snapshots in the source tree. Dagger generates them before rendering the frame. To generate it
manually:

```sh
pkl eval -m test/rails-cases/yjit-always-available \
  test/rails-cases/yjit-always-available/Fixtures.pkl
```

`Recordings.pkl` projects the same raw request/response format in capture,
local checks, and Dagger. The historical Pkl generator discovers its captured
modules by glob and uses that same projection, without a handwritten digest map.

The recorded requests, answers, responses, and capture provenance remain
committed as fixed Pkl values; no static YJIT JSON is tracked. Requests must not be regenerated from the current frame:
that would make the request-integrity assertion compare the implementation
against itself. The generated recordings reproduce the real capture from
2026-10-14. The SecureRandom recordings remain empty; that case has no captured baseline.
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
