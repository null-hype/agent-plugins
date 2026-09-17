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

# `devcontainer features test` bind-mounts this script's own directory
# (SCRIPT_FOLDER, from dev-container-features-test-lib) from a host scratch
# folder into the container -- confirmed by inspecting the CLI's own `docker
# run --mount type=bind,source=<host path>,target=/workspaces/<id>`
# invocation directly. Writing captured evidence here (not /tmp, which is
# container-only and gone once this container exits) is what lets
# tk-evidence-exporter pick these files up from the CI host after this
# scenario's container has already been torn down.
EVIDENCE_DIR="$SCRIPT_FOLDER/evidence"

# CIT-147: this scenario's own pass/fail verdict, written unconditionally on
# every exit path via the trap below. tk-evidence-exporter deliberately does
# NOT derive this scenario's outcome from the surrounding GitHub Actions
# job's conclusion: that job (a) runs every scenario in one
# `devcontainer features test` invocation, so its conclusion can't identify
# which scenario failed, and (b) is often still in progress when the
# exporter step runs later in the same job. Writing the verdict here --
# straight from this script's own exit code -- is the "another kind of test
# runner which does provide structured output" the exporter should rely on
# for this scenario, exactly as it already does for a Pkl-test-backed one
# via `pkl test --junit-reports`.
SCENARIO_OUTCOME=""

on_exit() {
    local exit_code=$?
    pass-cli logout || true

    mkdir -p "$EVIDENCE_DIR" 2>/dev/null || true
    if [ -z "$SCENARIO_OUTCOME" ]; then
        if [ "$exit_code" -eq 0 ]; then
            SCENARIO_OUTCOME="passed"
        else
            SCENARIO_OUTCOME="failed"
        fi
    fi
    printf '{"outcome": "%s"}\n' "$SCENARIO_OUTCOME" > "$EVIDENCE_DIR/scenario-outcome.json" 2>/dev/null || true
}
trap on_exit EXIT

if [ -z "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:-}" ]; then
    echo -e "\nSkipping restic-backup check: PROTON_PASS_PERSONAL_ACCESS_TOKEN not set.\n"
    SCENARIO_OUTCOME="skipped"
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

mkdir -p "$EVIDENCE_DIR"

restic_with_creds() {
    pass-cli run --env-file "$PASS_CLI_ENV_FILE" -- sh -c "
        set -e
        export GOOGLE_APPLICATION_CREDENTIALS=/tmp/gcp-service-account.json
        printf %s \"\$GCP_SERVICE_ACCOUNT_KEY\" > \"\$GOOGLE_APPLICATION_CREDENTIALS\"
        $1
    "
}

# CIT-147: capture the snapshot IDs already tagged $RESTIC_TAG *before*
# calling `color`, so the snapshot `color` produces below can be identified
# by set difference afterward rather than assumed to be "whichever one
# sorts last." This restic repo is a persistent remote (GCS) backend shared
# across CI runs, so `restic snapshots --tag restic-backup` can return
# snapshots from previous runs too -- picking the chronologically-last one
# is usually right but isn't a real identity guarantee; set difference is.
BEFORE_SNAPSHOT_IDS="$(restic_with_creds "restic snapshots --tag $RESTIC_TAG --json" | jq -r '.[].id' | sort)"

export PROTON_PASS_AGENT_REASON="pass-cli restic-backup feature test: exercising color's backup path"
# 'color' does the restic backup internally once it sees an active
# pass-cli session (see src/pass-cli/install.sh). This is the only step
# here that talks to a live claude - everything this test actually
# asserts on is local file/restic state, not the reply's content.
color

AFTER_SNAPSHOTS_JSON="$(restic_with_creds "restic snapshots --tag $RESTIC_TAG --json")"
printf '%s' "$AFTER_SNAPSHOTS_JSON" > "$EVIDENCE_DIR/restic-snapshots.json"
check "color's restic backup produced a snapshot tagged $RESTIC_TAG" \
    bash -c "[ \"\$(jq 'length' \"$EVIDENCE_DIR/restic-snapshots.json\")\" -gt 0 ]"

# The snapshot `color` produced just now, identified by set difference
# against BEFORE_SNAPSHOT_IDS (see above) rather than by array order. A
# plain `jq`/parsing failure here should not fail this test's own domain
# checks -- evidence capture is additive, not a new assertion.
NEW_SNAPSHOT_ID="$(printf '%s' "$AFTER_SNAPSHOTS_JSON" | jq -r --arg before "$BEFORE_SNAPSHOT_IDS" '
    ($before | split("\n")) as $beforeIds |
    [.[] | select(.id as $id | $beforeIds | index($id) | not)] | .[-1].id // empty
' || true)"
if [ -n "$NEW_SNAPSHOT_ID" ]; then
    restic_with_creds "restic ls $NEW_SNAPSHOT_ID --json" > "$EVIDENCE_DIR/restic-ls.json" || true
fi

# Move the local copy aside to prove the restore below isn't just
# reading the untouched original, then restore and confirm it's back.
mv "$HOME/.claude" "$HOME/.claude-preresume"
restic_with_creds "restic restore latest --tag $RESTIC_TAG --target /"

check "restic restore brings ~/.claude back" \
    bash -c "[ -d \"\$HOME/.claude\" ] && [ -n \"\$(ls -A \"\$HOME/.claude\")\" ]"

# Report result
# If any of the checks above exited with a non-zero exit code, the test will fail.
reportResults
