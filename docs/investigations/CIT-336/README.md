# CIT-336 — retain a scenario and replay it after disposal

This delivery maps milestone `20261008.0812` to SemVer package `0.3.0`.
It asks the existing `deleted-trace` question of historical S2 and restores
that same captured execution scope. CIT-335's S1/S2 packages (`0.2.0-s1` and
`0.2.0-s2`) still belong to `20261008.0811`; their historical checker revisions
remain distinct from these project deliveries.

From this repository, with Python 3.11+, Dagger, Docker and restic installed:

```sh
python3 scripts/cve-checker-retention.py run --output /tmp/cit336
python3 test/_global/cve-checker-retention.py /tmp/cit336
```

Use a fresh output directory. The first command builds the installed feature
through Dagger, captures the scenario, disposes its container, snapshots the
retained scope, restores the snapshot and evaluates it in a fresh container.
The second command exercises actual snapshots with missing or changed inputs,
an unavailable snapshot, nonempty output rejection and installed collection
failure controls. It leaves the successful capture and replay unchanged.

Capture and replay are also separate commands:

```sh
python3 scripts/cve-checker-retention.py capture --output /tmp/cit336-capture
python3 /tmp/cit336-capture/replay.py replay \
  --capture /tmp/cit336-capture --output /tmp/cit336-replay
```

The capture directory is portable: keep `repository/`, `repository-password`,
`retention.json`, `restic-backup.jsonl` and `replay.py` together. It uses a newly
generated password for this local repository. Capture does not read or write
the shared backup repository or a live vault. Replay needs Python, Docker and
restic; it does not invoke Dagger, install tooling, read a source checkout or
pull a registry image. It loads the restored image archive, then starts the
restoration container with `--network=none`. The local repository must remain
available; copying only `retention.json` is insufficient.

## What is retained and how identity is recorded

The existing forensics scenario's `checker-runtime` Dockerfile target supplies
the Node base. Dagger installs the feature and exports an OCI archive with the
actual Pkl/Deno binaries, question, shared decoder, checker loader and tooling.
Subject inputs are supplied separately by the scenario and captured before
the original container is removed. The runtime target has no application
inputs in its layers. This slice evaluates retained checker evidence; it does
not run a fresh Rails exploit or restore the original Rails application.

The snapshot payload contains:

| Path | Purpose |
| --- | --- |
| `runtime.oci.tar` | Installed runtime, image config and manifest |
| `case/` | Scenario-supplied pinned checker inputs and historical declarations |
| `bundle/` | Original capture, shared record, exact baseline/probe/control inputs, raw results and answers |
| `execution.json` | Source commit, dirty-path disclosure, command, tools, image identity, disposal receipt, trace availability and exclusions |
| `dagger-build.log`, `container.log` | Build/capture execution provenance |
| `cve-checker-retention.py` | Standalone orchestration source |

`retention.json` names the exact snapshot and inventories every payload file
with its bytes and SHA-256. The restic backup's reported ID is authoritative:
older restic versions report a short prefix, which is resolved only to that
reported snapshot's full ID. Replay never selects `latest` or an arbitrary
snapshot sharing a tag. The envelope sits outside the snapshot so it can name
the snapshot without a self-reference. The local working payload is deleted
after backup; replay restores only the pinned snapshot.

Image identity distinguishes the OCI manifest digest, config digest used by
Docker and whole-archive SHA-256. Source identity distinguishes the historical
S2 checker commit in the shared state from the feature/build checkout commit
in execution provenance. Local runs disclose modified source paths; the image
archive and payload hashes identify the actual executed bytes. Installation
evidence records the timestamp delivery, SemVer package, options and runtime
versions. The host execution records the command and Docker/Dagger/restic
versions.

Dagger's execution link is provenance, as documented by the shared evidence
contract; it is not a state backup. Capture records a real execution URL when
the Dagger log supplies one. A setup URL is rejected as execution provenance.
An outer CI invocation may report its URL only after capture finishes; replay
accepts that URL using `--trace-url` without rewriting the original snapshot.
Without a configured Dagger Cloud trace, the URL is an explicit gap and the
local build log remains available. No link is fabricated. CI exports the OCI
archive through the Dagger action first, then passes `--image` and the action's
actual `traceURL` into capture and restoration. For this path the local build
log identifies a caller-supplied archive; the full export log lives in the
linked Dagger invocation. Capture checks the archive's installed delivery
against the selected source delivery before snapshotting it.

The declared exclusions are live Rails/application state, fresh exploit runs,
agent/vault sessions, container writable state outside the capture scope,
host environment and Dagger/registry/Docker caches. The generated repository
password and repository are retained beside the snapshot, outside its scope.
CI uploads the complete capture as a GitHub Actions artifact, together with
the new evaluation and failure records. Its tar archive preserves file modes
and includes the generated password for this disposable local repository.
Restored payload copies are excluded from the upload because the pinned
repository already retains their exact bytes.

## Original observation and new evaluation

The original `bundle/capture.json` and `bundle/record.json` remain byte-for-byte
unchanged in the snapshot and restored payload. Their declarations, forecasts,
observations and image/snapshot gaps still describe the original invocation.

Replay verifies the exact retained inventory, bytes and hashes before loading
the image or executing the checker. The installed replay command cross-checks
the evidence descriptors too, then asks the checker of the retained
`runs/deleted-trace/inputs/` files. It does not rebuild a probe from a checkout.
The absent `canary-reads.txt` remains absent. Missing expected-example files
cannot turn into newly generated success baselines.

`record.json` in the replay output is a new standalone shared evaluation with
a fresh state ID. Its image/snapshot fields name the retained identities;
`replay-execution.json` links the original evaluation, repository, source,
execution time, command, runtime and trace. Original retained evidence paths
point under `retained/payload/bundle/`; new result and answer paths refer to
the new execution. The original historical source and declarations survive.
There is no invented source-changing investigation transition for a restore.

The existing Pkl Question derives the outcome. `comparison.json` checks the
collected answer and derived assessment against the original evaluation.
Both S2 executions pass 56 assertions and still miss the deleted trace, yielding
`out-of-range`. A failed collection emits `answer = null`, a retained error and
an explicit missing-answer observation; Pkl derives `not-collected`, and replay
fails. The host saves the container log, exit-status receipt and emitted report
before acting on a nonzero exit. Both failed capture and failed replay therefore
remain inspectable after their containers are disposed. If report copying
itself fails, the receipt records that failure and the container is preserved
for recovery. Missing snapshots/inputs or changed bytes fail before an answer
is produced. An unavailable exact snapshot has an explicit host error rather
than a dependency on restic's version-specific wording. Nonempty destinations
are refused before any restoration or writes.

## Retrieve a retained CI capture

The `cve-checker-retention` job uploads
`cit336-s2-<source-head-sha>-<run-id>-<run-attempt>` with a requested lifetime
of **90 days**. The run summary links its immutable artifact ID and records
the full snapshot ID, artifact digest, archive SHA-256 and retrieval command.
The artifact API's `expires_at` is authoritative; deletion of the artifact or
workflow run can shorten availability. This is a finite handoff, not permanent
storage.

The artifact contains `evidence.tar` and `handoff.json`. After choosing the
specific artifact linked from the successful run, use its exact name and run
ID (never a latest-run lookup):

```sh
gh run download <run-id> --repo null-hype/agent-plugins \
  --name <exact-artifact-name> --dir /tmp/cit336-download
mkdir -m 700 /tmp/cit336-retained
tar -xf /tmp/cit336-download/evidence.tar -C /tmp/cit336-retained
python3 /tmp/cit336-retained/capture/replay.py replay \
  --capture /tmp/cit336-retained/capture --output /tmp/cit336-rerun
```

Python, Docker and restic are the only replay prerequisites. A separate
`cve-checker-handoff` CI job downloads the uploaded artifact by its immutable
ID on a fresh runner, verifies its archive hash, and reruns from that capture
without checking out this repository or rebuilding an image. That job also
retains its new evaluation. The upload runs even if replay or the failure
controls fail, so their available evidence survives runner disposal; an
incomplete capture is explicitly identified in `handoff.json`.

This delivery retains **S2**. CIT-337 must establish retrievable, pinned evidence
for **both S1 and S2**, with an adequate retention lifetime for its clean build,
before removing any replaced viewer fixtures. It must regenerate the accepted
replay and each revision's Peek from those records.

## Fixture accounting and handoff

Compared with CIT-335's merged base, the historical archive, reproduction
inputs/results, generated `checker-inputs`, shared-module copies, viewer JSON
and shared-record golden are unchanged. That inventory remains **252 files /
713,553 uncompressed content bytes**, using CIT-335's documented counting scope.
This PR adds orchestration, replay implementation, regression controls and this
handoff; no new hand-authored replay result fixture is introduced.

The selected question's independently maintained result definitions remain
**4 → 4**: question range, existing consistency range, historical baseline-count
table and the installed outcome/control matrix. Restoration compares a new
answer to retained observations rather than adding another answer key. Local
restic/OCI artifacts add storage outside Git; retention is not a storage
reduction. Viewer-fixture removal remains pending CIT-337. Shared Pkl types and
record decoder are unchanged, and no generic equipment API from CIT-287 is
duplicated.

Validation covers installed capture/disposal/offline restoration, real restic
failure controls, nonzero host capture/replay controls, replay of the published
artifact on a fresh runner, the original S1/S2 installed deliveries, package generation
and packaging, Deno type checks, and 22 Pkl tests / 63 assertions. The source
and image identifiers, snapshot and per-file counts for a particular run are
in that run's `retention.json`; they are execution observations, not committed
answer definitions.

Underlying tool semantics: [restic restore](https://restic.readthedocs.io/en/stable/050_restore.html),
[Dagger container export](https://docs.dagger.io/reference/api/container/), and
[Dagger action trace output](https://github.com/dagger/dagger-for-github).
