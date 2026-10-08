## Summary

Follow-up review of #118 found the fix itself had three gaps. Closes all three:

1. **Trace negative controls mutated the derived count, not the retained trace.** `Reconcile.pkl` now re-derives the independent open count from a new `independent_trace_text` field (the retained per-arm `strace` lines embedded in each observation), not from the `independent_dummy_file_openat_count` int alone — plus a new `trace-count-mismatch` flag if the two ever disagree. Deleting or forging the retained trace text is now caught; it wasn't before.
2. **Input/configuration identity was incompletely checked.** `Claims.pkl` now pins the expected source-file sha256 and runtime config (`load_defaults`/`variant_processor`) for all four arms, not just the unblocked MAT arm. `Reconcile.pkl` flags `source-identity-mismatch`/`runtime-config-mismatch` on any arm that drifts from its pinned value.
3. **No tutorial/report hookup existed.** Added `tutorial-app/src/content/tutorial/part-4/rails-matlab-canary/` — a non-interactive lesson (`editor`/`terminal`/`previews: false`), following CIT-255's precedent for a recorded, non-replayable execution — that walks through all three review rounds and links `CIT-294.md` plus both `reports/` files, explicitly labeled as a recorded transcript.

Base branch is CIT-297's own branch (not `main`) because #117/#118 are still open and every file this PR touches only exists there.

## Test plan

- [x] Reproduced all four of the review's named mutations (deleted trace, forged blocked-arm trace, mismatched blocked-arm source hash, mismatched blocked-arm config) against the real `observations/*.json` in a scratch copy — each now fails `Reconcile.check` as expected.
- [x] Restored, unmodified suite passes 100% (`pkl test`: 25 facts / 71 asserts / 4 examples); real repo working tree was never touched during mutation testing.
- [x] `pkl eval -f json diagnose.pkl` produces empty flag lists for all four arms against the real data.
- [x] `npm ci && npm run build` in `tutorial-app/` builds the new lesson page without error (27 pages total, including `/part-4/rails-matlab-canary/1-the-check-that-finally-checks/`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01VA8fpXPX82YTYrxHFTxZzz
