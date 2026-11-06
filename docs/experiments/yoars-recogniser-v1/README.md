# Yoars recogniser evaluation, release v1.0.0

**Release tag:** `yoars-recogniser-protocol-v1.0.0`  
**Protocol frozen:** 2026-11-06, before recogniser authoring  
**Status:** scoring protocol sealed; the split membership is materialised by
`seal_split.py` from the CIT-592 run manifest.

This directory is the release unit for the preregistered comparison between a
Pkl recogniser and the yoars post-hoc auditor. A release is valid only when
`python3 verify_release.py` succeeds. In particular, a prose-only tag, a split
without every eligible run, or a changed prompt is not a release.

## Seal the split

CIT-592 supplies a JSON array whose rows contain `run_id`, `condition` and
`restic_snapshot`. Run IDs and snapshot IDs are immutable strings. Seal it with:

```sh
python3 docs/experiments/yoars-recogniser-v1/seal_split.py \
  cit-592-runs.json docs/experiments/yoars-recogniser-v1/split.json
python3 docs/experiments/yoars-recogniser-v1/verify_release.py
```

The script rejects duplicate or incomplete rows, sorts by `run_id`, and assigns
within each `condition` stratum by the first eight bytes of
`SHA-256("yoars-recogniser-v1\0" || run_id)`: the lowest 70% (rounding to the
nearest integer, ties impossible because `run_id` is unique) are development
and the remainder held-out. No outcome, auditor result, trace text or human
label participates. `split.json` records the source-file SHA-256 and every
assignment. After it exists, changing membership requires a new major release;
the held-out traces must not be opened until the recogniser artifact and frozen
thresholds have their own release tag (CIT-593).

Until CIT-592 provides that manifest, verification intentionally fails. That is
an instrument failure, not an empty successful release.

## Frozen protocol

The complete protocol is in [protocol.md](protocol.md). The two judge arms use
the byte-identical evidence envelope and [judge prompt](judge-prompt.md).
`verify_release.py` checks that the model, prompt digest, three output values,
missing-evidence rule, repeated-sample rule, aggregation, estimands, confidence
intervals and prior-exposure disclosure remain present. It also checks the
sealed split against the deterministic assignment.

The release tag must point at the commit containing `split.json`; create no tag
while verification reports `split.json is not sealed`.

