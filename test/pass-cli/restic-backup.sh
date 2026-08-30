#!/bin/bash

# This test file is executed against the 'restic-backup' scenario in
# test/pass-cli/scenarios.json, which builds on top of the
# ghcr.io/null-hype/devenv-linear-agent image (via
# test/pass-cli/restic-backup/Dockerfile) instead of a stock
# devcontainers base image, the same way the test/_global scenarios do.
#
# JIN-92 split: this is the feature-internal half of what used to live
# entirely inside test/_global/jin-91-resume-session.sh. "Does
# restic backup ~/.claude run when a pass-cli session is live" and
# "does restic restore bring files back" are properties of the
# 'pass-cli' feature's install.sh/color bin - deterministic, unit-style
# checks that don't need to assert anything about what a live claude
# call replies. The nondeterministic leaf (does a real `claude --resume`
# invocation faithfully reconstruct conversational state from a restored
# transcript) stays in test/_global/jin-91-resume-session.sh, which is
# the only place that needs a live model call to resolve.
#
# This test can be run with the following command (from the root of this repo)
#    devcontainer features test --features pass-cli .

set -e

# Optional: Import test library bundled with the devcontainer CLI
source dev-container-features-test-lib

if [ -z "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:-}" ]; then
    echo -e "\nSkipping restic-backup check: PROTON_PASS_PERSONAL_ACCESS_TOKEN not set.\n"
    reportResults
    exit 0
fi

if ! command -v pass-cli >/dev/null 2>&1; then
    curl -fsSL https://proton.me/download/pass-cli/install.sh | bash
fi

export PROTON_PASS_SESSION_DIR="/tmp/pass-agent-scenario"
pass-cli login
pass-cli info

# Matches this scenario's "tag" feature option in scenarios.json - the
# tag the 'color' bin's restic backup uses for this run's snapshot.
RESTIC_TAG="restic-backup"

cleanup() {
    pass-cli logout || true
}
trap cleanup EXIT

export PROTON_PASS_AGENT_REASON="pass-cli restic-backup feature test: exercising color's backup path"
# 'color' does the restic backup internally once it sees an active
# pass-cli session (see src/pass-cli/install.sh). This is the only step
# here that talks to a live claude - everything this test actually
# asserts on is local file/restic state, not the reply's content.
color

restic_with_creds() {
    pass-cli run --env-file "$PASS_CLI_ENV_FILE" -- sh -c "
        set -e
        export GOOGLE_APPLICATION_CREDENTIALS=/tmp/gcp-service-account.json
        printf %s \"\$GCP_SERVICE_ACCOUNT_KEY\" > \"\$GOOGLE_APPLICATION_CREDENTIALS\"
        $1
    "
}

restic_with_creds "restic snapshots --tag $RESTIC_TAG --json" > /tmp/restic-snapshots.json
check "color's restic backup produced a snapshot tagged $RESTIC_TAG" \
    bash -c "[ \"\$(jq 'length' /tmp/restic-snapshots.json)\" -gt 0 ]"

# Move the local copy aside to prove the restore below isn't just
# reading the untouched original, then restore and confirm it's back.
mv "$HOME/.claude" "$HOME/.claude-preresume"
restic_with_creds "restic restore latest --tag $RESTIC_TAG --target /"

check "restic restore brings ~/.claude back" \
    bash -c "[ -d \"\$HOME/.claude\" ] && [ -n \"\$(ls -A \"\$HOME/.claude\")\" ]"

# Report result
# If any of the checks above exited with a non-zero exit code, the test will fail.
reportResults
