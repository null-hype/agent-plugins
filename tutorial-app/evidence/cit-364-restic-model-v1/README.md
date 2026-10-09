# Modelled restic evidence: S1 → S2

`S1S2.pkl` is a standalone Pkl instance for CIT-364. It amends
`ResticEvidence.pkl`, which imports the existing exporter contract and uses
its `SnapshotRef`, `DiffEntry`, and `FileTreeEntry` directly. The only new
classes add claim provenance or the missing file-dump contents.

From the repository root:

```sh
pkl eval tutorial-app/evidence/cit-364-restic-model-v1/S1S2.pkl -f json
```

The module and every snapshot, diff entry and dump have
`provenance = "modelled"`. That literal applies to **every field inside the
claim**, including nested exporter values and file contents; it cannot be
changed to `observed` while conforming to this schema. Reading bytes from a
pinned capture does not establish that a new restic run holds those bytes.
CIT-366 can generate bindings for `ResticEvidence.pkl` and load the evaluated
instance without changing the old capture loader.

## Sources and scope

Snapshot and repository IDs are copied from
`../cit-337-captures-v1/bundle.json`. Dump contents are copied byte for byte
from its `bundle.tar.gz`, after checking the archive checksum and the pinned
file inventory. `archivePath` identifies the original exported file;
`entry.path` models its absolute restic path as `/bundle/<relative path>`.
Each dump carries the source snapshot ID and UTF-8 byte size.

There are 47 dumps: 22 for S1 and 25 for S2. They include all pinned checker
`inputs/` (including observations and S2 reports), both declarations, the
mutation description, and `result.txt` and `answer.json` for baseline,
deleted-trace, generic-crash and missing-observation. In particular, the two
baseline `inputs/canary-reads.txt` files and both deleted-trace outputs are
present. The raw output is retained, rather than the old lesson's formatted
summary. Both pinned deleted-trace answers report exit code 0; S2's increased
assertion count does not make that probe fail.

The 24 diff entries compare those paths by file bytes, report only changes,
and use the pinned S1/S2 IDs as endpoints. Three S2 input files are added;
the other 21 changes are modifications. `mutation.txt` is unchanged and has
no diff entry. This is a scoped model of the transition, not a claim to list
every file in either snapshot. Later fabricated probes and S3 are outside
these two pinned captures and outside this model.

## Claims still to verify

The source snapshots belong to **different restic repositories**. No
`restic diff` was run on them. CIT-367 must create a comparable pair in one
repository and verify the modelled path, change and content claims against
that run, retaining the distinction between source capture IDs and the new
run's IDs.

The pin does not provide snapshot tags or timestamps. `SnapshotRef` requires
strings for both, so `tag` and `takenAt` are explicitly empty modelled values,
not invented capture metadata. They remain unverified; an empty value must
not be reported as confirmed metadata. CIT-367 can replace these claims with
supported values when it has the real snapshot records.

No lesson, story, capture loader, generation path or CI configuration imports
this instance yet. Validation here requires Pkl only; it executes neither
restic nor the retained checker.
