#!/bin/bash

# Claude does a task, Codex reviews it: the agent-task feature ran when the
# container started (its postStartCommand) -- Claude changed count-lines.sh
# in the fixture checkout and committed, then codex-session reviewed that
# commit. This checks what it recorded in /tmp/agent-task/result.json.
#
#    devcontainer features test --global-scenarios-only --filter agent-task-codex-review .

set -e
source dev-container-features-test-lib

RESULT=/tmp/agent-task/result.json
cat "$RESULT"

if jq -e .skipped "$RESULT" >/dev/null; then
    echo -e "\nSkipping agent-task-codex-review: $(jq -r .skipped "$RESULT").\n"
    reportResults
    exit 0
fi

check "Claude's turn succeeded" jq -e '.claude.subtype == "success"' "$RESULT"
check "Claude committed" jq -e '.commits > 0' "$RESULT"
check "the change does the task" bash -c "cd /work/repo && printf 'a\nb\n' > /tmp/two && printf 'c\n' > /tmp/one && ./count-lines.sh /tmp/two /tmp/one | tail -1 | grep -Eq '^ *3 total$'"
check "pushing is blocked" bash -c "[ \$(git -C /work/repo remote get-url --push origin) = no-push ]"
check "Codex reviewed the commit" jq -e '.review.review.overall_correctness | type == "string"' "$RESULT"
check "the review's Codex session was backed up" jq -e '.review.snapshot != ""' "$RESULT"

reportResults
