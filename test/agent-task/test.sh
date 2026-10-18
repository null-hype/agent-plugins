#!/bin/bash

# Default installation: the bin is in place, and with no prompt the start
# hook records that it had nothing to do.

set -e

source dev-container-features-test-lib

check "agent-task is on PATH" bash -c "command -v agent-task"
check "the runner parses" bash -n /usr/local/share/agent-task/run.sh
check "no prompt, nothing done" jq -e '.skipped == "no prompt"' /tmp/agent-task/result.json

reportResults
