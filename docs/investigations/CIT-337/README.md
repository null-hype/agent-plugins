# CIT-337 — replay derived from canonical retained captures

The accepted S1/S2 replay and revision-specific Peek are generated from the
canonical CIT-336 restic captures named in
`tutorial-app/evidence/cit-337-captures-v1/capture-pins.json`.
The committed archive is a reproducible export of those snapshots, not an
independently collected or authored source of results. Viewing and building
the presentation do not execute a checker.

| Observation | Actions artifact / run | Exact restic snapshot |
| --- | --- | --- |
| S1, newly retained 2026-10-08 | 11530956643 / 37733705247 | `32e5155ee4528eb5432e2a08ff444ae549fd8a3089844993d433a11c7942eb7f` |
| S2, original CIT-336 observation | 11523970423 / 37715333357 | `3c0f3a7ecf8b11f81242d5bb5aef2063c01cc4764c821a7b477adbff7011e46d` |

S1 reuses CIT-336's capture machinery at the historical S1 checker revision.
It is explicitly a new observation: the earlier uncommitted viewer collection
could not be recovered. S2 reuses the actual retained CIT-336 observation,
rather than the separately collected viewer S2 run. Distinct executions are
not relabelled as the same capture. The historical PR/review declarations,
missing reviewer output and unresolved forecasts retain their original meaning.
The state IDs identify historical checker revisions; the capture pins identify
the selected executions.

The pins record repository and artifact identity, artifact digest and expiry,
source commit, restic repository identity, full snapshot ID, transport and
retention-envelope hashes, observation time, and every selected path with its
bytes and SHA-256. Export restores each exact snapshot through
`scripts/cve-checker-retention.py restore`'s shared implementation, verifies
the complete retained inventory and OCI identity, then selects its existing
`bundle/` files. The existing shared decoder combines their records.
The viewer verifies the generated archive, complete exported inventory,
canonical capture selection, selected-file hashes and Pkl evaluation.

## Retrieve and regenerate

Use Node 22, Python 3.11+, restic, and Pkl 0.32.1. Supply a GitHub token with
Actions read access to this repository through `GITHUB_TOKEN`.

```sh
cd tutorial-app
npm ci
npm run replay:export
npm run replay:generate -- --check-existing
npm test
npx playwright install --with-deps chromium
npx playwright test --config playwright.replay.config.ts
RAILS_PROBES_NO_SERVERS=1 npx playwright test \
  --config playwright.questions.config.ts \
  --project rails-probes:consistency --project rails-probes:lesson
npm run build-storybook
npm run build
cd ..
python3 scripts/cve-checker-fixture-accounting.py
```

Export caches the exact Actions artifact ZIPs under
`${CIT337_CAPTURE_CACHE:-${TMPDIR:-/tmp}/cit337-captures}`; cached bytes must
match their pinned hashes. The cache contains the portable restic repositories
and their generated local passwords. An absent artifact, changed bytes, wrong
snapshot/repository, missing retained file or detached export fails explicitly.
There is no latest-snapshot selection or fallback to authored answers.

Actions requested **90 days** of retention. The pinned API expiry is
2027-01-06T05:42:14Z for S1 and 2027-01-06T01:55:40Z for S2.
Deletion can shorten availability. Preserve the complete pinned ZIPs, or each
capture's repository, password and retention envelope together, before expiry
to keep regeneration available. No indefinite availability is claimed.
The committed export remains renderable after Actions expiry, but does not
replace the full retained captures needed to verify and regenerate it.
Dagger trace links remain execution provenance, not complete state backups.

## Verified fixture replacement

`fixture-accounting.json` records the exact 50-file scope and accepted base
commit `09f1c11276ffa0f49aca65d719b018f072f2a397`, with individual hashes.
Every regenerated file matched that tree byte for byte before removal.

| Selected maintained fixtures | Before | After |
| --- | ---: | ---: |
| Files | 50 | 0 |
| Uncompressed bytes | 150,446 | 0 |
| Independently maintained result-definition sets | 4 | 4 |

The 50 files comprise four Storybook replay JSON files, four introducing-lesson
traces, six selected active probe files and 36 carried lesson copies.
The 36 carried copies are now removed from Git and regenerated as ignored
presentation files. Historical evidence outside this selected scope remains.
The four existing authored sets are the question range, consistency range,
historical baseline-count table and installed outcome/control matrix;
this slice introduces no separately authored answer matrix.

Generated storage is reported separately: the export contains 151 files and
368,992 uncompressed bytes, compressed to 65,812 bytes. Its generated inventory
and capture pins add metadata. The canonical captures also retain the runtime
and other evidence. These figures are not a claim of a whole-repository or
total-retention storage reduction.

## Verification

A fresh local checkout installed dependencies, downloaded both exact Actions
artifacts and restored their named snapshots without executing experiments.
A second fresh output directory regenerated an identical archive and manifest.

- 50 accepted fixture files verified byte for byte; zero remain tracked.
- Unit tests: 298 passed, one skipped, including missing/changed evidence and
  canonical-pin rejection checks.
- Replay and revision-specific Peek acceptance: eight passed.
- Checker questions, consistency and lesson controls: 16 passed.
- Storybook and TutorialKit production builds passed.

The first concurrent browser run had three failures while the lesson compiler
was rewriting files; the sequential rerun passed all eight. The
`retained-viewer` Actions job repeats clean retrieval, export equality,
fixture accounting, acceptance and builds on a fresh runner. CI must finish
successfully before merge. CIT-338 remains the next contrasting-case slice.
