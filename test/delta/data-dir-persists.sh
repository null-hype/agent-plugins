#!/bin/bash
set -e
source dev-container-features-test-lib

# Do not add a mount in scenarios.json: the feature must supply it.
# Mountinfo field 5 is the mount point. A directory in the container's
# writable layer is not enough to preserve sign-in across a rebuild.
check "Delta data directory is a mount" awk -v path="$HOME/.local/share/delta" '
    $5 == path { found = 1 }
    END { exit !found }
' /proc/self/mountinfo
check "remote user can write persistent Delta state" touch "$HOME/.local/share/delta/.feature-test"

reportResults
