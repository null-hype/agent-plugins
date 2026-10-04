## Summary
- Runs the real Rails -> libvips `matload` -> libmatio/HDF5 -> dummy file bytes -> returned variant chain live, byte-exact, which the merged forensics fixture (synthesized PNGs, no libvips/libmatio invocation) couldn't demonstrate.
- Four runs on one pinned Rails 7.0.10/libvips 8.13.0/libmatio 1.5.23 image: unblocked MAT canary (disclosure), blocked MAT canary (refused, no disclosure), PNG control under both blocking states.
- Declared/observed/checked Pkl records (`Claims.pkl`/`Observation.pkl`/`Reconcile.pkl`/`cit294.test.pkl`) reconcile each run's own JSON output against independently-written expectations, following `src/noteexpand`'s pattern.
- Isolated and documented why this needed Debian bookworm instead of CIT-272/277/278's bullseye (bullseye's HDF5 1.10.6 can't resolve an HDF5 External File List dataset through libvips' info-only matio call, independent of libmatio's own version).
- Found and worked around `image_processing`'s default thumbnail sharpen convolution, which mutates pixel bytes even at 1:1 scale and would have made byte-exact recovery unverifiable.

See `docs/investigations/CIT-265/CIT-294.md` for the full write-up.

## Test plan
- [x] `docker build -f cit-294/Dockerfile -t cit294:live .` from `docs/investigations/CIT-265/` builds cleanly
- [x] `cit-294/run_arms.sh` reproduces all four arms with matching `strace` evidence and JSON observations
- [x] `pkl test cit294.test.pkl` from `cit-294/` passes (8 facts / 28 asserts / 4 examples) against the live observations

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01VA8fpXPX82YTYrxHFTxZzz
