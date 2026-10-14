#!/bin/bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)/rails-experiment
: "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:?Live agent composition requires a token}"
export PROTON_PASS_KEY_PROVIDER=fs
export PROTON_PASS_SESSION_DIR=$(mktemp -d)
export PROTON_PASS_AGENT_REASON='rails-experiment global scenario: proposer and challenger over claim/control evidence'
trap 'pass-cli logout >/dev/null 2>&1 || true' EXIT
pass-cli login
pass-cli info
# Keep evidence in the mounted scenario folder for the CI artifact uploader.
work=$(mktemp -d "$here/runs.XXXXXX")
for case in control counterexample; do
    status=0
    pass-cli info
    pass-cli run --env-file "$here/agent.env" -- rails-experiment \
        "$here/$case.pkl" "$work/$case" --baseline "$here/$case-expected.pcf" || status=$?
    if [ "$case" = control ]; then test "$status" -eq 0; else test "$status" -eq 1; fi
done
pkl test -p runs="$work" "$here/Pair.test.pkl"
