#!/bin/bash

# The 'test/_global' folder is a special test folder that is not tied to a single feature.
#
# This test file is executed against a running container constructed
# from the value of 'jin-81-pass-cli' in the tests/_global/scenarios.json
# file, which builds on top of the ghcr.io/null-hype/devenv-linear-agent
# image (via test/_global/jin-81-pass-cli/Dockerfile) instead of a stock
# devcontainers base image.
#
# This scenario passes "tag": "jin-81-pass-cli" as a 'pass-cli' feature
# option in scenarios.json (matching this scenario's name), which is
# what the 'color' bin uses as its restic snapshot tag for this run's
# claude session transcript. Any future scenario copied from this one
# for a different task should set that option to that task's name the
# same way this one is named after, and tagged, jin-81-pass-cli.
#
# This test can be run with the following command (from the root of this repo)
#    devcontainer features test --global-scenarios-only .

set -e

# Optional: Import test library bundled with the devcontainer CLI
source dev-container-features-test-lib

echo -e "The result of the 'color' command will be:\n"
color
echo -e "The result of 'playwright-cli --version' will be:\n"
playwright-cli --version
echo -e "\n"

# Feature-specific tests
# The 'check' command comes from the dev-container-features-test-lib.
check "check green is my favorite color" bash -c "color | grep 'my favorite color is green'"
check "check playwright-cli's skill was installed" bash -c "test -f \$HOME/.claude/skills/playwright-cli/SKILL.md"

# Log in so the 'color' bin's own pass-cli/claude/restic block (see
# src/pass-cli/install.sh) has an active session to use - PASS_CLI_ENV_FILE
# is baked into this scenario's Dockerfile and the restic tag comes
# from the 'pass-cli' feature's own "tag" option (see scenarios.json), so
# invoking `color` after login exercises the pass-cli skill and restic
# snapshot end to end, the same way any real consumer of the feature would.
if [ -n "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:-}" ]; then
    echo -e "\nAsking claude its favorite color:\n"

    if ! command -v pass-cli >/dev/null 2>&1; then
        curl -fsSL https://proton.me/download/pass-cli/install.sh | bash
    fi

    export PROTON_PASS_SESSION_DIR="/tmp/pass-agent-scenario"
    # PROTON_PASS_KEY_PROVIDER=fs is baked into this scenario's Dockerfile
    # (not set here) so it applies to anything in the container that
    # calls pass-cli, not just this script.
    pass-cli login
    pass-cli info

    export PROTON_PASS_AGENT_REASON="devcontainer scenario test: ask claude its favorite color"

    status=0
    color > /tmp/color-output.txt || status=$?
    cat /tmp/color-output.txt
    if [ "$status" -eq 3 ]; then
        echo "Skipping Claude skill check: credential unavailable; restic backup completed."
    else
        check "color completed" test "$status" -eq 0
        check "Claude reports the pass-cli skill" grep -i pass-cli /tmp/color-output.txt
    fi

    pass-cli logout || true
else
    echo -e "\nSkipping credential checks: PROTON_PASS_PERSONAL_ACCESS_TOKEN not set.\n"
fi

# Report result
# If any of the checks above exited with a non-zero exit code, the test will fail.
reportResults
