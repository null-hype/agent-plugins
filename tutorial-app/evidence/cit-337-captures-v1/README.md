# Pinned checker case evidence

This directory retains the CIT-337 capture pin. Its S1/S2 snapshot instance
lives beside the source bundle so case contents stay outside the installed
feature. CIT-335 places executable checker inputs in the scenario image at
`test/_global/cve-2026-66066-forensics/checker-inputs/`; this instance models
the retained outputs of that case. See
[the scenario layout](../../../docs/investigations/CIT-335/README.md).

## Pinned S1 → S2 instance

`S1S2.pkl` imports the feature's `Restic.pkl`, defines two `Snapshot`s and computes `changes` with
`Restic.diff(S1, S2)`. Each snapshot ID appears once; file paths identify dump
contents within the owning snapshot. There are no hand-written diff entries,
exporter wrappers, or per-value provenance flags. Whether the snapshot model
has been checked against a real run belongs to CIT-367's verification result.
CIT-366 supplies bindings through which the tutorial consumes this model.

The IDs and repositories come from
`bundle.json` alongside the instance.
The 47 file contents are copied byte for byte from its pinned `bundle.tar.gz`:
22 files in S1 and 25 in S2. Exported `<state>/<relative path>` becomes
`/bundle/<relative path>` in that state's `files`. The model includes checker
inputs and observations, S2 reports, declarations, the mutation description,
and the baseline, deleted-trace, generic-crash and missing-observation results
and answers. The raw outputs are preserved, including exit code 0 for both
deleted-trace answers.

The diff derives 24 changes: three additions and 21 modifications. This is the
scope copied from the captures, rather than a complete inventory of either
restic snapshot. Later fabricated probes and S3 are outside this instance.
The source snapshots belong to different repositories; no real `restic diff`
has compared them. CIT-367 must create a comparable pair in one repository
and compare its output to the computed changes and file contents.

The pins supply neither real snapshot timestamps nor tags. `takenAt` remains
empty and `tags` is an empty listing. An observation timestamp is not used as
a snapshot time.

From the repository root:

```sh
pkl eval tutorial-app/evidence/cit-337-captures-v1/S1S2.pkl -f json
pkl test src/cve-2026-66066/questions/restic/Restic.test.pkl \
  tutorial-app/evidence/cit-337-captures-v1/S1S2.test.pkl
```

Evaluation needs neither the original archive nor the tutorial app runtime. These
commands run Pkl only; they do not invoke restic or a checker.
