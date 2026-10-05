# CIT-294 probe reproduction `v1` inputs (CIT-307)

Three files the pinned #117 checker imports but `cit-294-review-history-v1` does
not bundle (Pkl modules the suite imports, and the expected-examples file `pkl test` compares against; that bundle holds only what an evidence reference points at):

| Path | Git blob id | Taken from |
| --- | --- | --- |
| `inputs/Claims.pkl` | `a6cf7949c033dcfb5b4ae85dbe53413443cc97f5` | `390a7873ea6fd639c1c735393848e03b05031cc3` |
| `inputs/Observation.pkl` | `6e1594b8483db9a0b272e01daa9e3edf1d10271b` | `390a7873ea6fd639c1c735393848e03b05031cc3` |
| `inputs/cit294.test.pkl-expected.pcf` | `73d902a2a97e4ecfed10775c831b3f3427cab44a` | `390a7873ea6fd639c1c735393848e03b05031cc3` |

`20aafd26` (the commit review 1 cited) is not on main, so the bytes come from
the merged equivalent `390a787`. Both commits hold the same
`docs/investigations/CIT-265/cit-294` tree, `67f1115f84415958fc070e804a054220eed4c92d`
(`treeEquality` in `../cit-294-review-history-v1/manifest.json`), so these are
the bytes S1 had. `tests/rails-probes/probes.ts` re-derives both blob ids from
the files here before running anything.

These files are checker **inputs** only. Output from running the probes is a
new reproduction and is never written into the historical bundle: that bundle
records that the original reviewers' mutation outputs were not retained.
