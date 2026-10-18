#!/bin/bash

# Checks for the cit-271-free-agent-hintN scenarios, SOURCED by each thin
# per-level script after it sets LEVEL. The cit-271-free-agent feature ran
# the detector when the container started (its postStartCommand); this only
# reads the result it recorded.

set -e
source dev-container-features-test-lib

RESULT="/tmp/cit-271-traces/L${LEVEL}/result.json"
cat "$RESULT"

if jq -e .skipped "$RESULT" >/dev/null; then
    echo -e "\nSkipping CIT-271 hint-$LEVEL checks: PROTON_PASS_PERSONAL_ACCESS_TOKEN not set.\n"
    reportResults
    exit 0
fi

check "hint-$LEVEL ran at its own level" jq -e ".level == $LEVEL" "$RESULT"
check "hint-$LEVEL produced a trace per state x repeat" jq -e '.traces == 2 * .repeats' "$RESULT"
check "hint-$LEVEL: no tripwire, crash, or isolation breach (0 tools)" jq -e '.failed == false' "$RESULT"
check "hint-$LEVEL: restic snapshot of ~/.claude recorded a snapshot id" jq -e '.snapshot != ""' "$RESULT"

reportResults
