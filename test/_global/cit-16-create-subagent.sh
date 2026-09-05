#!/bin/bash

# The 'test/_global' folder is a special test folder that is not tied to a
# single feature.
#
# Third "agent-spec" scenario for the refresh-spec/distillation pattern
# (see jin-90-dead-drop, jin-91-resume-session). Where those two prove
# pass-cli secret retrieval and restic-backup restorability, this one
# proves a scoped, headless `claude -p` turn can itself drive Claude
# Code's own agent machinery: spawning a subagent (CIT-16) and having
# that subagent start a self-pacing loop via the loop skill (CIT-14,
# a sub-issue of CIT-16).
#
# Named cit-16-create-subagent (not jin-NN) because these two issues
# come from a different Linear team than the jin-* issues that seeded
# the earlier scenarios in this folder; the naming convention (a short,
# stable scenario name matching the ticket) otherwise follows theirs.
#
# This test can be run with the following command (from the root of this repo)
#    devcontainer features test --global-scenarios-only .

set -e

# Optional: Import test library bundled with the devcontainer CLI
source dev-container-features-test-lib

if [ -z "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:-}" ]; then
    echo -e "\nSkipping create-subagent check: PROTON_PASS_PERSONAL_ACCESS_TOKEN not set.\n"
    reportResults
    exit 0
fi

if ! command -v pass-cli >/dev/null 2>&1; then
    curl -fsSL https://proton.me/download/pass-cli/install.sh | bash
fi

export PROTON_PASS_SESSION_DIR="/tmp/pass-agent-scenario"
pass-cli login
pass-cli info

cleanup() {
    pass-cli logout || true
}
trap cleanup EXIT

export PROTON_PASS_AGENT_REASON="cit-16-create-subagent scenario: running scoped agent turn that spawns a subagent and starts a loop"
# --allowedTools=Agent,Skill,Bash (equals form, not a space) - see
# jin-90-dead-drop.sh for why the space form swallows the prompt as a
# tool name. Agent and Skill (not just Bash) are on the allowlist here
# because they are the exact tools under test: without them the model
# cannot spawn a subagent or invoke the loop skill at all, and would be
# free to just parrot the confirmation lines back from the prompt
# without ever doing either - see the transcript-based checks below,
# which is why this scenario doesn't just grep the response text the
# way jin-90-dead-drop does.
#
# model/effort match the CIT-16 ticket's own spec ("haiku, low effort")
# for the outer call under test; the prompt asks it to drive a second,
# inner agent turn (the subagent) itself.
#
# A fixed session id (same trick as 'color resume', see
# src/pass-cli/install.sh) is what lets the checks below inspect the
# raw transcript for actual Agent/Skill tool_use entries afterwards,
# instead of trusting the model's own summary of what it did.
SESSION_ID="$(cat /proc/sys/kernel/random/uuid)"

# 'claude -p' is a single, non-interactive turn, so a self-pacing loop
# (which works by scheduling a wakeup for a future turn) has no later
# turn in this session to resume into. The prompt therefore only asks
# the subagent to *invoke* the loop skill, not to keep looping - that's
# the part of CIT-14 that's actually verifiable inside one -p call.
response="$(pass-cli run --env-file "$PASS_CLI_ENV_FILE" -- claude -p --session-id "$SESSION_ID" --model haiku --effort low --permission-mode dontAsk --allowedTools=Agent,Skill,Bash "Use the Agent tool to spawn a subagent. Have that subagent invoke the loop skill (the /loop skill) to start a self-pacing loop for a trivial one-line task. Once both steps are done, reply with exactly two lines: \"subagent: created\" and \"loop: started\".")"

echo "$response" > /tmp/create-subagent-response.txt
echo -e "\nAgent response:\n$response\n"

TRANSCRIPT="$(ls "$HOME"/.claude/projects/*/"$SESSION_ID".jsonl 2>/dev/null | head -n1)"

# Feature-specific tests
# The 'check' command comes from the dev-container-features-test-lib.
# These grep the raw session transcript for the actual tool_use calls,
# not just the model's closing summary - a model given --allowedTools
# it never touches could still print the same two confirmation lines
# by copying them out of the prompt.
check "session transcript was recorded" bash -c "[ -n '$TRANSCRIPT' ] && [ -f '$TRANSCRIPT' ]"
check "agent actually invoked the Agent tool to spawn a subagent" bash -c "grep -qi '\"name\":\"Agent\"' '$TRANSCRIPT'"
check "subagent actually invoked the loop skill" bash -c "grep -qi '\"name\":\"Skill\"' '$TRANSCRIPT' && grep -qi 'loop' '$TRANSCRIPT'"
check "agent confirms it created a subagent" bash -c "grep -qi 'subagent: created' /tmp/create-subagent-response.txt"
check "agent confirms it started a loop" bash -c "grep -qi 'loop: started' /tmp/create-subagent-response.txt"

# Report result
# If any of the checks above exited with a non-zero exit code, the test will fail.
reportResults
