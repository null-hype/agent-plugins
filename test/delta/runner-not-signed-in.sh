#!/bin/bash
set -e
source dev-container-features-test-lib

# This fresh container has no injected credentials or browser approval.
# The feature's postStartCommand must use this same installed hook.
check "unsigned-in runner hook does not fail container startup" timeout 30s delta-runner-start
check "runner log explains the skipped start" grep -i "not signed in" "$HOME/.local/share/delta/runner.log"

reportResults
