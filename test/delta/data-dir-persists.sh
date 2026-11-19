#!/bin/bash
set -e
source dev-container-features-test-lib

# Do not add a mount in scenarios.json: the feature must supply it.
# Resolve the feature's home-directory link to its user-independent mount.
# A directory in the container's writable layer is not persistent state.
check "Delta data directory is a mount" awk -v path="$(readlink -f "$HOME/.local/share/delta")" '
    $5 == path { found = 1 }
    END { exit !found }
' /proc/self/mountinfo
check "remote user can write persistent Delta state" touch "$HOME/.local/share/delta/.feature-test"

reportResults
