#!/bin/bash

# CIT-286 toy-case scenario (global): the toy case (CIT-285) through the same
# Pkl-defined contract as cit-286-contract, plus the only place a paid run can
# happen.
#
# Mode is CONTRACT_MODE (forwarded by scenarios.json, default 'deterministic').
# In ordinary CI it is deterministic: canned evidence, mock Jev, zero real
# calls, credentials ignored. 'live-jev' and 'full-experiment' run only when
# selected AND opted in (CONTRACT_ALLOW_REAL_JEV / CONTRACT_ALLOW_REASONING_AGENT);
# they are launched from the dedicated manual workflow, never from push/PR CI.
# A disabled live mode prints NOT RUN; it is never reported as a pass.
#
# Self-contained (skill Rule S): the toy root and the Pkl scenario are baked into
# the image by this scenario's Dockerfile. The scenario (canned/expected
# evidence, expectations) is at /opt/scenarios, outside the inspected root
# /opt/toy-case/root (Rule D4).

set -e

source dev-container-features-test-lib

S=/opt/scenarios/cit-286-toy-smoke
ROOT=/opt/toy-case/root
MODE="${CONTRACT_MODE:-deterministic}"

check "pkl runtime installed"        pkl --version
check "evidence-validate on PATH"    bash -c "command -v evidence-validate"
check "jev on PATH"                  bash -c "jev --help >/dev/null"
check "toy inspected root baked in"  test -f "$ROOT/opt/toy/README.md"
check "scenario answer material is OUTSIDE the inspected root (Rule D4)" \
    bash -c "test -f '$S/cit-286-toy-smoke.pkl' && ! grep -rq 'expectations\|toy_unenforced' '$ROOT'"
check "scenario invariants hold (pkl test)" \
    pkl test --module-path /usr/local/share/evidence/pkl "$S/cit-286-toy-smoke.test.pkl"

# Live modes call out (pass-cli login etc. is the caller's job); the driver
# prints NOT RUN / BLOCKED / results itself and exits non-zero only on a failed
# check or an explicitly requested mode that was blocked or refused.
check "toy scenario, mode=$MODE" python3 "$S/cit-286-toy-smoke_test.py" --mode "$MODE" --report-live

reportResults
