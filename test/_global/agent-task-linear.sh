#!/bin/bash

# agent-task in linear mode, as Render's dispatcher runs it: the codespace
# rendered from this scenario (.devcontainer/agent-task-linear/) takes its
# task from the Linear session in its display name. Outside a codespace there
# is no session, so the task must skip rather than run or fail.
#
#    devcontainer features test --global-scenarios-only --filter agent-task-linear .

set -e
source dev-container-features-test-lib

RESULT=/tmp/agent-task/result.json
cat "$RESULT"

check "linear mode skips outside a codespace" jq -e '.skipped == "linear mode runs in a codespace"' "$RESULT"
check "the Linear helper is installed" test -x /usr/local/bin/agent-task -a -f /usr/local/share/agent-task/linear.sh
check "gh is installed, for the display name, the PR and the delete" command -v gh
check "linear.env holds only Pass references" bash -c "! grep -v '^#' /usr/local/share/agent-task/linear.env | grep -v '=pass://'"

reportResults
