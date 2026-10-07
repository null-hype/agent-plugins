## Summary

Addresses the CIT-297 review request-changes on #117 (commit `20aafd2`). All four points were reproduced and independently re-verified fixed, re-running against the real `observations/*.json` from the already-built, already-proven `cit294:live` image (no rebuild needed):

1. **Independent read evidence now reaches the checker.** `run_arms.sh` derives `independent_dummy_file_openat_count` (plus source/image identity and the live `load_defaults`/`variant_processor` config) entirely outside `canary_runner.rb`'s own process and merges it into each arm's JSON; `Reconcile.pkl` checks it against `Claims.pkl`'s `independentReadExpected`. Deleting the trace, or forging a dummy-file read into the blocked arm, is now flagged.
2. **A generic crash no longer passes as a successful block.** `Reconcile.pkl` now requires the *actual variant call's* `variant_error_class`/`variant_error` to match the claimed refusal specifically, not the preliminary loader-probe's `loader_error`.
3. **Byte recovery is validated directly, not trusted through a boolean.** `returned_bytes_hex`/`returned_byte_count` are checked against pinned expected values in `Claims.pkl`, plus a dedicated check that those raw fields and the self-reported `matches_dummy_file` boolean agree.
4. **Actual detector output and an authoritative check result are now retained.** Added `diagnose.pkl` (Reconcile's flags per arm → committed `reports/diagnostics.json`, following noteexpand's `diagnostics.json` pattern) and wired `pkl test --junit-reports` into `run_arms.sh`, committing the real JUnit result to `reports/cit294.test.xml`.

`cit294.test.pkl` gained eight negative-control facts covering the review's five exact mutations (deleted trace, forged blocked-arm read, generic crash, emptied bytes, corrupted PNG pixels) plus the two direct-`Reconcile.check` attacks it named (crash with no error info; stripped bytes with the boolean left `true`) — all now flagged.

Base branch is CIT-294's own (`cit-294-demonstrate-the-live-matlabhdf5-file-read-path-and-blocking`, PR #117), not `main`: #117 is still unmerged and every file this PR touches only exists on that branch.

## Test plan

- [x] `pkl test --junit-reports reports cit294.test.pkl`: 18 facts / 56 asserts / 4 examples, 100% pass
- [x] Each of the review's 5 exact mutations, reproduced against the real `observations/*.json` in a scratch copy (not inline Pkl literals), now fails the suite; restoring the originals still passes 100%
- [x] The 2 additional direct-`Reconcile.check` attacks the review named are both now flagged
- [x] Re-ran `./run_arms.sh` end-to-end against the existing `cit294:live` image to regenerate all committed evidence fresh

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01VA8fpXPX82YTYrxHFTxZzz
