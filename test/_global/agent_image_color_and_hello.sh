#!/bin/bash

# The 'test/_global' folder is a special test folder that is not tied to a single feature.
#
# This test file is executed against a running container constructed
# from the value of 'agent_image_color_and_hello' in the tests/_global/scenarios.json file,
# which builds on top of the ghcr.io/null-hype/devenv-linear-agent image
# (via test/_global/agent_image_color_and_hello/Dockerfile) instead of a
# stock devcontainers base image.
#
# This test can be run with the following command (from the root of this repo)
#    devcontainer features test --global-scenarios-only .

set -e

# Optional: Import test library bundled with the devcontainer CLI
source dev-container-features-test-lib

echo -e "The result of the 'color' command will be:\n"
color
echo -e "The result of the 'hello' command will be:\n"
hello
echo -e "\n"

# Feature-specific tests
# The 'check' command comes from the dev-container-features-test-lib.
check "check green is my favorite color" bash -c "color | grep 'my favorite color is green'"
check "check I am greeting with 'Greetings'" bash -c "hello | grep 'Greetings, $(whoami)'"

# Ask the 'claude' CLI (bundled in the devenv-linear-agent image) its
# favorite color, authenticating with a Claude Code OAuth token that
# pass-cli resolves at run time from the pass:// URI in this scenario's
# .env file. PROTON_PASS_PERSONAL_ACCESS_TOKEN is propagated into this
# container via the scenario's containerEnv.
if [ -n "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:-}" ]; then
    echo -e "\nAsking claude its favorite color:\n"

    if ! command -v pass-cli >/dev/null 2>&1; then
        curl -fsSL https://proton.me/download/pass-cli/install.sh | bash
    fi

    export PROTON_PASS_SESSION_DIR="/tmp/pass-agent-scenario"
    # pass-cli's default key storage backend relies on the OS keyring
    # (Secret Service over D-Bus), which isn't available in this headless
    # container and makes login fail with NoStorageAccess(PermissionDenied).
    # Fall back to filesystem-based key storage, which works in CI/containers.
    export PROTON_PASS_KEY_PROVIDER="fs"
    pass-cli login
    pass-cli info

    export PROTON_PASS_AGENT_REASON="devcontainer scenario test: ask claude its favorite color"
    # Baked into the image by this scenario's Dockerfile (see
    # test/_global/agent_image_color_and_hello/.env and Dockerfile).
    PASS_CLI_ENV_FILE="/opt/pass-cli/agent_image_color_and_hello.env"

    # One live claude call doing double duty: it answering at all proves
    # auth worked, and asking it to name its skills (rather than just
    # checking SKILL.md landed on disk) proves the pass-cli skill is
    # actually being picked up.
    check "claude answers and reports having the pass-cli skill" bash -c \
        "pass-cli run --env-file '$PASS_CLI_ENV_FILE' -- claude -p 'What is your favorite color? Also list the names of any skills you currently have available, one per line.' | tee /tmp/claude-output.txt | grep -qi 'pass-cli'"

    # Snapshot the claude session transcript (~/.claude) to restic, so later
    # sessions can find this run's transcript via `restic snapshots --tag jin-81`.
    # restic's GCS backend wants GOOGLE_APPLICATION_CREDENTIALS pointing at a
    # key *file*, not the inline JSON pass-cli resolves into
    # GCP_SERVICE_ACCOUNT_KEY, so materialize that first.
    check "restic snapshot of ~/.claude" bash -c \
        "pass-cli run --env-file '$PASS_CLI_ENV_FILE' -- sh -c '
            set -e
            export GOOGLE_APPLICATION_CREDENTIALS=\"/tmp/gcp-service-account.json\"
            printf %s \"\$GCP_SERVICE_ACCOUNT_KEY\" > \"\$GOOGLE_APPLICATION_CREDENTIALS\"
            restic backup ~/.claude --tag jin-81
        '"

    pass-cli logout || true
else
    echo -e "\nSkipping 'ask claude its favorite color' check: PROTON_PASS_PERSONAL_ACCESS_TOKEN not set.\n"
fi

# Report result
# If any of the checks above exited with a non-zero exit code, the test will fail.
reportResults
