# One capture, one check, one viewer

The case is Rails `fddf74bea9`. Follow the `always` claim from its outgoing Jev
request to its raw response, confidence expectation, and visible editor lens.

`Recordings.pkl` derives records from `jev/*/request.json` and the corresponding
raw `response.json`. `Frame.pkl` turns those records into the existing viewer's
model. `Confidence.test.pkl` checks the same observation against `[0, 0.2]` and
the reviewed `inRange` expectation. The score is printed for diagnosis; it is
not an exact-value golden. None of these steps needs result transcription.

## Run with a retained capture

In a development environment with the current `rails-cases` and `jev` features
installed, run these commands from the repository root:

```sh
mkdir -p build/yjit-example
pkl eval -m build/yjit-example test/rails-cases/yjit-always-available/Fixtures.pkl
cp test/rails-cases/yjit-always-available/commit.txt build/yjit-example/
export RAILS_CASE_EVIDENCE="$PWD/build/yjit-example"
export RAILS_CASE_HASH=fddf74bea9
bash test/rails-cases/yjit-always-available.sh
```

This materializes the genuine 2026-10-14 capture. It does not call Jev. The
observed `0.48` is outside `[0, 0.2]`, agreeing with the current `inRange = false`.
The script derives `recordings.json` and `frame.json` in the supplied directory
before invoking the ordinary Pkl tests. Original request/response files and
the expected PCF are never rewritten.

Show that exact frame in the existing Storybook:

```sh
cd tutorial-app
npm ci
npm run storybook -- --no-open
```

Open **Investigations / Rails commit claims / Yjit Always Available**. The
`always` lens shows `Jev 0.48 that it holds`; following it opens the request
identified by the capture's digest. `RAILS_CASE_EVIDENCE` selects the generated
frame at startup. No fixture JSON is copied into the application source.

To see a disagreement, change only `inRange` to `true` in
`Confidence.test.pkl-expected.pcf`, then rerun the same case script from the
repository root. It exits nonzero, reporting `0.48` and the range disagreement.
The generated frame remains available to the viewer. Restore the expectation
after reviewing the result; the script never updates it automatically.

## Use a fresh Jev capture

Run the existing global scenario with its normal Proton Pass credentials:

```sh
npx --yes @devcontainers/cli features test \
  --global-scenarios-only --filter yjit-always-available \
  --preserve-test-containers .
```

The scenario prints its `rails-cases-captures/yjit-always-available` directory.
Set `RAILS_CASE_EVIDENCE` to that absolute directory (or the extracted capture
artifact) and run the same case script and Storybook commands above. Skip the
historical `Fixtures.pkl` materialization. The capture stage checks integrity;
the case check evaluates the confidence expectation against that fresh result.

## Use the existing Dagger consumer

The check and browser/HAR exporter also accept the capture directly:

```sh
dagger call yjit-always-available --evidence "$RAILS_CASE_EVIDENCE"
dagger call yjit-always-available-har --evidence "$RAILS_CASE_EVIDENCE" \
  export --path build/yjit-replay
```

Omitting `--evidence` uses the retained capture. The check ends with the same
confidence test. The HAR export checks request integrity and browser behavior
without gating export on the confidence hypothesis, so a disagreeing result can
still be inspected. It includes the raw capture, derived frame, and replay.

## Verification of this change

The case script was run against the retained real response and isolated copies:

| Input | Expected check | Derived `always` lens |
| --- | --- | --- |
| Real retained response: `0.48` | Pass, outside the range | `Jev 0.48 that it holds` |
| Synthetic response mutation: `0.49` | Pass, still outside | `Jev 0.49 that it holds` |
| Synthetic response mutation: `0.10` | Fail, inside the range | `Jev 0.1 that it holds` |

The mutations are wiring checks, not new Jev observations. They leave the
committed capture and expectation unchanged. The generic Pkl fixture generator
also reproduces all 14 original JSON values. No claim of a fresh API call or
Docker/Dagger runtime validation is made for this environment.

Storybook's static build succeeded and its YJIT bundle contains the supplied
`0.48` lens; all three Rails stories are indexed. Browser playback was not run:
the browser download endpoint was unavailable. The Dagger file was formatted
and syntax-checked; compilation needs the generated Dagger bindings and engine,
which this workspace lacks.
