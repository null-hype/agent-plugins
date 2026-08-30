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
# Unlike the first version of this scenario, the plant/backup/move
# aside/restore/resume/verify mechanism itself is NOT defined here: it's
# baked into the 'color' bin's own "resume" subcommand (see
# src/pass-cli/install.sh, `color resume`), matching the pattern the
# 'color' bin already uses for its default backup behaviour (exercised
# by jin-81-pass-cli.sh). This script's job is only to log in and then
# exercise that bin like any real consumer of the feature would, not to
# reimplement the behaviour under test.
#
# Reuses jin-81-pass-cli's restic/GCP secrets (shared backup infra, see
# this scenario's .env) rather than provisioning a second copy under a
# new vault item. The restic tag 'color resume' backs up to/restores
# from comes from the pass-cli feature's own "tag" option, set in
# scenarios.json to "jin-91-resume-session" to match this scenario's
# name and Dockerfile SCENARIO_NAME (see that Dockerfile's comment).
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

cleanup() {
    pass-cli logout || true
}
trap cleanup EXIT

echo -e "\nRunning 'color resume'...\n"
# Capture 'color resume's own exit status via PIPESTATUS rather than
# the pipeline's (which would just be tee's, always 0): a failure in
# 'color resume' (e.g. the restored snapshot missing the transcript, or
# the resumed session not recalling the codeword) needs to fail this
# scenario, not just print a message and carry on.
color resume | tee /tmp/resume-response.txt
resume_status="${PIPESTATUS[0]}"
echo -e "\nAgent response:\n$(cat /tmp/resume-response.txt)\n"

# Feature-specific tests
# The 'check' command comes from the dev-container-features-test-lib.
check "'color resume' exits successfully" bash -c "exit $resume_status"
check "restored session recalls the codeword planted before backup" bash -c "grep -q 'codeword:' /tmp/resume-response.txt"

# Report result
# If any of the checks above exited with a non-zero exit code, the test will fail.
reportResults
