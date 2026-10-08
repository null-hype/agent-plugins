# CIT-338 — retained forecast execution through the shared replay record

The forecast viewer consumes a **pinned installed-feature execution**, alongside
CIT-337's retained checker observations. Normal `replay:generate` verifies the
committed export, decodes `Question.Investigation`, and renders the original
presentation. It never calls `captureForecast`, installs a feature, registers a
question, freezes a round, or substitutes checkout inputs when evidence is absent.
This slice stops before migrating the remaining corpus.

## Identified delivery and retained execution

Feature **0.4.0**, delivery **20261008.0814**, finding `forecast.split`, scenario
`test/_global/cve-forecast-replay` was installed and executed in
[run 37745970383](https://github.com/null-hype/agent-plugins/actions/runs/37745970383).
The source PR head was `c3ff942ae42d9d444f6c50ae6d6ff448173bdf58`; the actual
checkout/execution commit was its clean CI merge
`016c9f3966098f18f484591b1220af60e9ebf408`.

`tutorial-app/evidence/cit-338-captures-v1/capture-pins.json` selects
[artifact 11535628610](https://github.com/null-hype/agent-plugins/actions/runs/37745970383/artifacts/11535628610):

- Artifact name: `cit338-forecast-c3ff942ae42d9d444f6c50ae6d6ff448173bdf58-37745970383-1`.
- Artifact SHA-256: `f9f96d797fc1d8a22c8e990ce3ca2b1484d61dc4d6680fd2e22c77c7012e6049`.
- Restic repository: `252719ba7336187e242c3c7eb22a7a9f72b8562ddccc42ed122586d10c73f7f1`.
- Snapshot: `de1ac972d64c2b1dc8ef6aebe92eaf7ad93b2d44383e9c4e56d96a6591091e11`.
- New linux/amd64 runtime OCI manifest: `sha256:678ceff20054e91b8d4f7419df87f193daff697cfce202dad5c4a6f6329952b8`.
- New runtime config: `sha256:b56439f28414d8df518d227b83d953992a49151d241de0a3981dc3b06ededa57`.

The pin also identifies the OCI archive, transport and retention-envelope hashes,
selected bundle inventory, delivery, execution start, and source/input identities.
The export includes `execution.json`, `container-execution.json`, `retention.json`
and `source-inputs.json`: hashes/bytes for feature sources, shared primitives,
installer, scenario and retention tooling, plus the nine historical inputs.
The source inventory hash is
`sha256:2e35f93906a2ecc0a7d58e7f6ce4184b3b41ae8137f7cc318895ab84d54bce28`;
historical input-pin hash is
`sha256:ccb0831cd94f4cc65beba7150dd7e45049a6cea26b8cc4f91e77d467419d67d6`.
The image contains the installed Pkl 0.32.1 / Deno 2.9.7 tooling and adapter.

**This is a new execution of historical files. No historical stub-round container
image or snapshot exists.** The original input commit remains
`c897e8d41b633fc539b9bd558c7e7bd69f18d369`, frozen trees/readings remain
`5282c7e` and `12f2351`, and the registration events belong to the original
`20261006T065648Z-stub` round. Its records keep their image/snapshot gaps.

## Retention, retrieval and expiry

The `retained-forecast` CI job uses the installed Dagger scenario image. Host-side
collection copies `/report`, logs and the execution receipt **before** disposal;
collection failure leaves the container available for recovery. The host snapshots
the raw input scope, capture, typed record, image and provenance in a portable
private restic repository. The live payload is removed, then a separate operation
restores the exact snapshot and re-executes the scenario with networking disabled.
CI publishes the repository/password, image and verification evidence, including
when verification fails. `forecast-handoff` downloads it on a runner without a
checkout or installer and verifies it again.

Requested Actions retention is **90 days**. The selected artifact's API expiry is
**2027-01-06T07:50:49Z**; early deletion or access loss is possible. Download and
preserve the exact artifact before expiry for continuing full-image reproduction.
No registry, cache or indefinite remote availability is promised. The committed
small viewer export survives in Git and remains sufficient for rendering after
artifact expiry; full-snapshot retrieval fails explicitly if unavailable. New CI
captures are separate observations and never automatically replace the viewer pin.

Retrieve and verify the exact snapshot without running capture or Docker:

```sh
export GITHUB_TOKEN="$(gh auth token)"  # repository Actions read access
python3 scripts/cve-forecast-viewer-export.py \
  --output /tmp/cit338-export/records --cache /tmp/cit338-artifacts \
  --retain-capture /tmp/cit338-capture
cmp /tmp/cit338-export/bundle.tar.gz tutorial-app/evidence/cit-338-captures-v1/bundle.tar.gz
cmp /tmp/cit338-export/bundle.json tutorial-app/evidence/cit-338-captures-v1/bundle.json
```

`--retain-capture` is optional; it retains the verified portable repository for
re-execution. The ordinary export only restores/verifies, with no experiment run.
`npm run replay:export` regenerates both checker and forecast committed exports
from their exact artifact pins. Rendering the committed exports needs Pkl, Node
and tar; retrieval additionally needs Python 3.11+, restic and Actions access.

Re-execute as a distinct verification against the pinned image, without checkout,
registry, installation download or historical application:

```sh
python3 /tmp/cit338-capture/replay.py reexecute \
  --capture /tmp/cit338-capture --output /tmp/cit338-verification
```

This restores retained evidence, verifies the original record, loads the retained
OCI image, and calls `cve-forecast-reexecute` with `--network=none`. The adapter
collects a new assessment from copied historical inputs and compares it with the
retained assessment. Original files/receipts remain under `retained/`; the new
capture and comparison remain under `evaluation/`. `verification.json` links the
original snapshot/execution to the new execution and its timestamps. Reproduction
never rewrites the retained installation evidence or claims a new registration.

## Common path and adapter boundary

Both slices use `cve-checker-retention.py`'s container collection/disposal,
`retain_payload`, exact-snapshot `restore`, complete inventory and OCI verification;
`cve-checker-viewer-export.py`'s `restore_selected` artifact/handoff/repository
verification and deterministic `write_export`; and the viewer's
`tests/retained/export.ts` archive, pins and selected-file verification. Both
then use the shared `questions/Decode.pkl` and content-addressed evidence checker.
The shared path therefore connects an installed execution, retained snapshot,
export and viewer; it is not limited to decoding a checkout capture.

Forecast tree types, conjunction interpretation, historical registration joins,
and replay rendering remain in the forecast adapter. `TreeTypes.pkl` removes the
renderer/decoder's need to import the original scenario tree. **No shared schema
field or validation rule changed.** Existing declarations, forecasts, gaps and
transitions represent the case. The common decoder handles numeric Jev answers
and checker objects according to the existing judge constraints; this case emits
no exposure answer.

The root remains **0.5**, premises **0.4** and **0.8**, conjunction read as
independent implies **0.32**, and its accounted difference remains **−0.18** with
the original explanation. Registration/read-back raw bytes, event reasons,
actions and timestamps remain unchanged. Every exposure answer remains
`null` / `not-collected`; computed readings describe reasoning, not exposure.
Registration evidence belongs to the split head, not its earlier base.

## Fixture accounting and validation

`fixture-accounting.json` and `scripts/cve-forecast-fixture-accounting.py` compare
against main `70a41b6`. Forecast maintained fixtures go **11 / 41,963 bytes →
10 / 16,795 bytes**. The one **25,168-byte** maintained presentation becomes
ignored generated output. All ten original historical files remain tracked and
byte-identical: nine pinned scenario inputs plus the original live-tree expected
reading (215 bytes), which remains outside the capture export.

Independently maintained result definitions are accounted by document, including
validation expectations: **5 → 6**. Historical expected-reading PCFs remain at
three; the redundant presentation document is removed; existing UI preservation
assertions remain and two record/scenario validation matrices are added. Thus
result documents go **4 → 3**, validation matrices **1 → 3**. The report claims
removal of maintained presentation, not elimination of testing expectations.
Original forecasts, combination assumptions and registrations remain source
evidence, not additional answer keys. Generated presentation/unpacked storage and
the committed compressed export/pins are separate; compression is not counted as
fixture reduction.

```sh
npm --prefix tutorial-app run replay:generate -- --check-existing
python3 scripts/cve-forecast-fixture-accounting.py
python3 scripts/cve-forecast-clean-viewer.py --output /tmp/cit338-clean
npm --prefix tutorial-app test
cd tutorial-app
STORYBOOK_PORT=6038 npx playwright test --config playwright.replay.config.ts
npm run build-storybook
npm run build
```

The clean-workspace check copies only retained transport tooling, decoder/types
and renderer: no historical tree/round/frozen input checkout, capture adapter,
installer, registration implementation or re-execution code. It downloads the
pinned artifact, restores the export and regenerates the accepted presentation.
Unit controls reject absent/tampered exports, missing/changed raw evidence and
invented answers, verify execution/source identity, and preserve installation
bytes during decoding. Browser acceptance checks Tab, reload and Peek and checks
that historical round hashes and the round directory set do not change.
The accepted presentation SHA-256 remains
`2bab48bbe97db101e650c2480adeef079b27cbebcce7ce0cf16d5d3d483fcf51`.
