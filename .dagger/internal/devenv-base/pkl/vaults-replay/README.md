# Vaults case adapter (CIT-339)

Vaults is an optional transfer case for the versioned investigation feature.
It does not complete CIT-333 or migrate another part of PR152's corpus.
This revision replaces this PR's repeated source trees and standalone runner
with a deduplicated retained capsule and an adapter installed by the existing
`cve-2026-66066` feature. The mapped delivery is `20261008.0744` /
`0.4.0-vaults`; the scenario is the existing forensics scenario's `vaults-runtime`
target. Applications under test are the original Vaults Pkl contract and its
retained inventory; no live vault is accessed.

`evidence.tar.gz` retains each unique byte sequence once. `inputs.json` maps
both historical source revisions' original paths to content-addressed blobs,
including all 19 resources per state. Original layouts exist only in disposable
workspaces. Source SHA-256 and git blob IDs are verified before execution.
`evidence.tar.json` pins the capsule and every retained member.

The inventory is the original metadata from CI run 35171754006, captured on
2026-09-17. Both original expected PCFs remain retained. The earlier host
execution is preserved under `legacy.json`, with its original timestamp,
outputs and bytes; it is explicitly a schema experiment, not a delivered round.
The selected installed execution has a separate identity and receipt.
Its assessments derive from raw command outputs, exit statuses and captured
declarations. No answer JSON or rendered record is maintained as a fixture.
Generated baselines are retained as reproduced evidence, without replacing the
historical expected PCFs. Record types remain unchanged.

The pinned execution is `vaults-5c3f2f3a-0788-4ba7-9990-a637d9cf6df0`,
captured with clean tooling source commit `91a3ac2cdf2f87e078c922295b8122ade56c9b0c`.
`retention-execution.json` in the capsule identifies the original image manifest,
archive hash, snapshot, source, runtime and disposal receipt. Its full portable
restic repository and OCI archive are retained separately at
`/tmp/cit339-retention/capture` in the implementation workspace. This local
repository is not embedded in Git or claimed to be a published registry image.
Each CI execution uploads its own full repository and runtime as a separate
90-day artifact; its image/snapshot IDs belong to that new execution.

The selected raw post-generation checks report 6/7 tests and 69/71 assertions
before reconciliation (exit 1), then 7/7 tests and 72/72 assertions afterward
(exit 0). These are observations derived from this execution, not authored
replay expectations. The original expected PCF is tested and retained before
`--overwrite` produces a separate baseline.

Use the shared capture/retention path:

```sh
python3 scripts/cve-checker-retention.py run --state Vaults --output /tmp/vaults-run
python3 /tmp/vaults-run/capture/replay.py view \
  --capture /tmp/vaults-run/capture --output /tmp/vaults-view
```

`view` restores the exact retained snapshot and image, reads the original
assessment and validates its record; it never invokes `pkl test`.
`replay` performs a new offline check with a new execution ID, then compares
its answers and generated baselines with the original. Neither rewrites the
original snapshot. All container execution is network-disabled. The shared host
lifecycle collects evidence before disposal, retains the installed OCI runtime
and an exact restic snapshot, and verifies the entire restored inventory.
A Dagger trace, if available, is only provenance.

To inspect the selected assessment, unpack the verified capsule and invoke
`cve-investigation-view` inside the installed Vaults runtime. To perform a new
check, run the installed adapter's `check <original> <fresh-output>` command.
The capsule needs only its mapped inputs; it never fetches either historical
checkout. The selected exact runtime is restored by the portable repository's
`replay.py`, rather than reconstructed from a mutable image tag.

CI runs the installed feature in the disposable scenario, restores from only
the retained bundle and pinned runtime image, verifies the before/after results,
and refuses missing/changed inputs, baselines, raw outputs, tool identity and
execution receipts. It uploads each new execution separately, with 90-day
artifact retention; those artifacts are additional reproductions, not silent
updates to the pinned original.

See `fixture-accounting.json` for tracked fixture counts/bytes, independently
maintained result definitions, and retained storage/duplicate content. The
claim is reduction of this optional slice's duplicate representations; the
broader project's delivery and PR152 fixture accounting remain separate.

| Representation | Before | After |
| --- | ---: | ---: |
| Active tracked result fixtures | 4 files / 49,318 bytes | 0 files / 0 bytes |
| Materialized tracked source inputs | 76 paths / 106,808 bytes | 0 paths; 38 references to 22 unique blobs |
| Executable result definitions | 2 | 1 question range |
| Retained evidence in Git | 93 files / 193,001 bytes | 2 storage files / 38,800 bytes |

The new capsule preserves the legacy evidence as well as the installed run.
Its 40 content-addressed blobs have zero duplicate content bytes; metadata is
reported separately by the accounting script. The separate runtime snapshot
holds 178,100,492 uncompressed payload bytes, including the 177,987,072-byte
OCI archive, with zero identical-file duplicate bytes. Evidence in Git and
in the full snapshot overlaps intentionally for portability; those two storage
scopes are not added together or described as a global deduplication claim.
