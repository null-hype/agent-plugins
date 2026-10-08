# CIT-338 — a contrasting retained case through the shared record

The CIT-330 forecast/premise split now uses the same `Question.Investigation`,
`EvaluationRecord`, decoder, evidence verification, replay generation entrypoint,
Storybook client and native Peek as the S1/S2 deleted-trace checker replay.
The forecast-specific adapter lives under `questions/forecast/`; no Rails or
forecast-tree fields were added to the shared schema.

Feature **0.4.0**, delivery **20261008.0814**, installs forecast capture and
replay alongside the checker commands. `forecast-delivery.json` associates
`forecast.split` with `test/_global/cve-forecast-replay`; `delivery.json` retains
S2 as the checker case packaged by the same version. Earlier delivery mappings
and CIT-337's canonical restic captures remain pinned to their original versions.

## Retained scope and history

`questions/forecast/inputs.json` pins nine files by exact bytes and SHA-256:
the original tree, the frozen tree and reading at `5282c7e` and `12f2351`, and
the retained `20261006T065648Z-stub` round's register, monitor, reading and round
metadata. The originals remain retained in Git. The scenario image supplies
these inputs; the installed feature supplies code and shared primitives.

The adapter evaluates both frozen trees, checks each against its original
frozen reading, and types the resulting case through the shared decoder.
The root investigation has two states and a split transition. Each new premise
has a head-state record. The source identifier is the frozen file's content
digest; the pin also records the historical commit identities. The root stays
at **0.5**, the premises at **0.4** and **0.8**. Declarations preserve conjunction
read as independent, its implied **0.32**, the accounted **−0.18**, and the original
explanation. Those computed readings are observations of the argument, never
exposure answers. All exposure answers remain `null` / `not-collected`.

Original round events remain byte-identical files. Registration/read-back
observations attach to the split head; the base does not claim registration
happened there. Their original question IDs, reasons, actions and timestamps
remain inspectable through Peek. Current installation evidence is reproduced;
the copied tree and round evidence is historical. No real pass-cli execution,
application image or historical container snapshot is claimed. This slice
retains files needed for reasoning replay; it does not capture a live Jev run.

## Schema accounting

**No shared schema field or validation rule changed.** Existing declarations,
forecasts, evidence gaps and investigation transitions represent this case.
Conjunction structure and registration interpretation belong to the case adapter.

`questions/Decode.pkl` is the common decoder, moved out of the checker directory;
the original import remains a compatibility wrapper. Its answer decoder now
accepts numeric Jev probabilities as well as checker answer objects, as the
schema already permits. Existing judge validation rejects a checker object for
a Jev question and a number for a checker question. The adapter emits no answers.
Both viewers use `questions/retained.ts` to verify referenced content digests.

## Capture, dispose inputs, and replay

```sh
docker build --target installed -f test/_global/cve-forecast-replay/Dockerfile \
  -t cit338-forecast .
docker run --rm cit338-forecast bash -euc '
  cve-forecast-capture /forecast-input /tmp/capture
  rm -rf /forecast-input
  cve-forecast-replay /tmp/capture /tmp/replayed
  /usr/local/share/cve-2026-66066/runtime/bin/deno run \
    --allow-read /check.ts /tmp/replayed
  cmp /tmp/capture/record.json /tmp/replayed/record.json
'
```

Replay checks input pins and hashes, restores a temporary input scope, re-derives
the records from retained sources, and compares the capture and typed records.
Missing/changed files and injected answers fail explicitly. Replay requires
the matching feature version and private Pkl 0.32.1 runtime; it never executes
`round.ts` or either registration implementation (`stub` / `passCli`).

## Regenerate presentation and verify

```sh
cd tutorial-app
npm ci
npm run replay:generate -- --check-existing
npm test
STORYBOOK_PORT=6038 npx playwright test --config playwright.replay.config.ts
npm run build-storybook
npm run build
```

The single replay generator validates the canonical checker export and captures
the forecast's pinned retained inputs. Its forecast output lives in ignored
`evidence/cit-338-forecast-v1/` and `src/stories/forecast-replay.json`. The latter
replaces the maintained presentation JSON and matches its previously accepted
bytes exactly. The story reads only generated JSON and raw retained evidence;
browsing, Tab acceptance, reloads and Peek neither run a collector nor register
or freeze a round. Browser acceptance checks that the original round files and
round directory set remain unchanged. No visible wording, order or interaction
changed. The rest of the corpus remains outside this migration.

## Verification results

- Shared-schema Pkl checks: 7 tests / 33 assertions passed.
- Preserved registration protocol: interruption/immutability stub test passed;
  frozen tree checks and all 13 retained-register join checks passed.
- Unit suite: 303 passed, one pre-existing skip. Includes restored rendering,
  missing/changed evidence, invented answers, and judge/answer mismatch checks.
- Browser acceptance: all 8 replay and revision-specific Peek checks passed.
- Installed Feature: capture, remove original inputs, restore/replay, check
  original forecasts/events/gaps, and compare records passed.
- Storybook and TutorialKit production builds passed.
- CIT-337's 50-file fixture accounting and package-source checks passed.

The first two browser attempts failed on the first checker story's dynamic
module fetch while this worktree shared another checkout's `node_modules` cache.
After installing this worktree's own dependencies, all eight checks passed. No
product or acceptance-test behavior was changed to accommodate that failure.
The generated forecast JSON SHA-256 is
`2bab48bbe97db101e650c2480adeef079b27cbebcce7ce0cf16d5d3d483fcf51`, identical
to its previous committed presentation.
