#!/bin/bash

# The 'test/_global' folder is a special test folder that is not tied to a
# single feature.
#
# Second "agent-spec" scenario for the refresh-spec/distillation pattern
# (see jin-90-dead-drop). Where jin-90 proves pass-cli secret retrieval,
# this one proves the *other* half of what jin-81-pass-cli's 'color' bin
# sets up but never itself verifies: that a restic snapshot of ~/.claude
# is actually restorable, and that `claude --resume` on the restored
# transcript picks up where the original session left off.
#
# Mechanism: plant a fresh, single-use codeword in a brand-new session
# (fixed --session-id so it can be resumed later), restic-backup
# ~/.claude/projects, move that directory aside locally to prove what
# follows isn't just reading the untouched original, restic-restore the
# snapshot, then --resume that same session id and ask for the codeword
# back. Only ~/.claude/projects moves - not all of ~/.claude - since the
# OAuth credential cache and installed pass-cli skill also live there
# and both later claude invocations still need them intact.
#
# Reuses jin-81-pass-cli's restic/GCP secrets (shared backup infra, see
# this scenario's .env) rather than provisioning a second copy under a
# new vault item.
#
# JIN-92 split: the restic backup/restore steps below are scaffolding
# only, not independently asserted here - "does restic back up/restore
# correctly" is a deterministic, feature-internal property, covered by
# test/pass-cli/restic-backup.sh instead. This scenario keeps only the
# leaf that requires a live model call to resolve: does a real
# `claude --resume` invocation faithfully reconstruct conversational
# state from a transcript it didn't generate this run.
#
# This test can be run with the following command (from the root of this repo)
#    devcontainer features test --global-scenarios-only .

set -e

# Optional: Import test library bundled with the devcontainer CLI
source dev-container-features-test-lib

if [ -z "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:-}" ]; then
    echo -e "\nSkipping resume-session check: PROTON_PASS_PERSONAL_ACCESS_TOKEN not set.\n"
    reportResults
    exit 0
fi

if ! command -v pass-cli >/dev/null 2>&1; then
    curl -fsSL https://proton.me/download/pass-cli/install.sh | bash
fi

export PROTON_PASS_SESSION_DIR="/tmp/pass-agent-scenario"
pass-cli login
pass-cli info

# A fixed session id (rather than parsing one out of --output-format
# json) is what makes step 2 below able to name the exact session to
# resume without any string-scraping.
SESSION_ID="$(cat /proc/sys/kernel/random/uuid)"
CODEWORD="$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
RESTIC_TAG="jin-91-resume-session"

cleanup() {
    pass-cli logout || true
}
trap cleanup EXIT

export PROTON_PASS_AGENT_REASON="jin-91-resume-session scenario: planting codeword in a fresh session"
pass-cli run --env-file "$PASS_CLI_ENV_FILE" -- claude -p \
    --session-id "$SESSION_ID" --model haiku --effort low \
    --permission-mode dontAsk --allowedTools=Bash \
    "Remember that the codeword is $CODEWORD. Reply with exactly one line: ok"

echo -e "\nBacking up ~/.claude/projects (tag: $RESTIC_TAG) and moving the local copy aside...\n"
pass-cli run --env-file "$PASS_CLI_ENV_FILE" -- sh -c "
    set -e
    export GOOGLE_APPLICATION_CREDENTIALS=/tmp/gcp-service-account.json
    printf %s \"\$GCP_SERVICE_ACCOUNT_KEY\" > \"\$GOOGLE_APPLICATION_CREDENTIALS\"
    restic backup \$HOME/.claude/projects --tag $RESTIC_TAG
"
# Move only the transcript directory aside, not the whole ~/.claude tree:
# that tree also holds the OAuth credential cache and the installed
# pass-cli skill, neither of which this scenario is testing the
# restorability of, and both of which the next two claude invocations
# still need to behave like the first one.
mv "$HOME/.claude/projects" "$HOME/.claude-projects-preresume"

echo -e "\nRestoring the snapshot...\n"
pass-cli run --env-file "$PASS_CLI_ENV_FILE" -- sh -c "
    set -e
    export GOOGLE_APPLICATION_CREDENTIALS=/tmp/gcp-service-account.json
    printf %s \"\$GCP_SERVICE_ACCOUNT_KEY\" > \"\$GOOGLE_APPLICATION_CREDENTIALS\"
    restic restore latest --tag $RESTIC_TAG --target /
"

export PROTON_PASS_AGENT_REASON="jin-91-resume-session scenario: resuming restored session to read back the codeword"
response="$(pass-cli run --env-file "$PASS_CLI_ENV_FILE" -- claude -p \
    --resume "$SESSION_ID" --model haiku --effort low \
    --permission-mode dontAsk --allowedTools=Bash \
    "What was the codeword? Reply with exactly one line: \"codeword: <value>\".")"

echo "$response" > /tmp/resume-response.txt
echo -e "\nAgent response:\n$response\n"

# Feature-specific tests
# The 'check' command comes from the dev-container-features-test-lib.
check "restored session recalls the codeword planted before backup" bash -c "grep -q '$CODEWORD' /tmp/resume-response.txt"

# Report result
# If any of the checks above exited with a non-zero exit code, the test will fail.
reportResults
