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
