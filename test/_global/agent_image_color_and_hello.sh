#!/bin/bash

# The 'test/_global' folder is a special test folder that is not tied to a single feature.
#
# This test file is executed against a running container constructed
# from the value of 'agent_image_color_and_hello' in the tests/_global/scenarios.json file,
# which builds on top of the ghcr.io/null-hype/devenv-agent image instead of a stock
# devcontainers base image.
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

# Ask the 'claude' CLI (bundled in the devenv-agent image) its favorite
# color, authenticating with a Claude Code OAuth token fetched from Proton
# Pass via pass-cli. PROTON_PASS_PERSONAL_ACCESS_TOKEN is propagated into
# this container via the scenario's containerEnv.
if [ -n "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:-}" ]; then
    echo -e "\nAsking claude its favorite color:\n"

    if ! command -v pass-cli >/dev/null 2>&1; then
        curl -fsSL https://proton.me/download/pass-cli/install.sh | bash
    fi

    export PROTON_PASS_SESSION_DIR="/tmp/pass-agent-scenario"
    pass-cli login
    pass-cli info

    export PROTON_PASS_AGENT_REASON="devcontainer scenario test: ask claude its favorite color"
    CLAUDE_CODE_OAUTH_TOKEN="$(pass-cli item view "pass://JIN-76/claude/CLAUDE_CODE_OAUTH_TOKEN")"
    export CLAUDE_CODE_OAUTH_TOKEN

    check "claude answers a prompt" bash -c "claude -p 'What is your favorite color?'"

    pass-cli logout || true
else
    echo -e "\nSkipping 'ask claude its favorite color' check: PROTON_PASS_PERSONAL_ACCESS_TOKEN not set.\n"
fi

# Report result
# If any of the checks above exited with a non-zero exit code, the test will fail.
reportResults
