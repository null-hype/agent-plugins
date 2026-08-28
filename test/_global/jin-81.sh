#!/bin/bash

# The 'test/_global' folder is a special test folder that is not tied to a single feature.
#
# This test file is executed against a running container constructed
# from the value of 'jin-81' in the tests/_global/scenarios.json file,
# which builds on top of the ghcr.io/null-hype/devenv-linear-agent image
# (via test/_global/jin-81/Dockerfile) instead of a stock devcontainers
# base image.
#
# This scenario passes "tag": "jin-81" as a 'pass-cli' feature option in
# scenarios.json (matching this scenario's name), which is what the
# 'color' bin uses as its restic snapshot tag for this run's claude
# session transcript. Any future scenario copied from this one for a
# different task should set that option to that task's name the same
# way this one is named after, and tagged, jin-81.
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

    # 'color' answering at all proves auth worked; asking it to name its
    # skills (rather than just checking SKILL.md landed on disk) proves
    # the pass-cli skill is actually being picked up. 'color' also does
    # the restic snapshot internally when it detects an active session.
    # pipefail: without it, only grep's exit code would matter, so a
    # failure inside color itself (e.g. the restic backup failing)
    # wouldn't fail this check as long as "pass-cli" appeared somewhere
    # in whatever partial output it produced before failing.
    #
    # grep -i without -q (not >/dev/null via -q's early exit): -q exits
    # as soon as it finds a match, closing the pipe while color is still
    # running its restic backup afterward - pass-cli's Rust binary then
    # panics on the resulting broken pipe (SIGPIPE) instead of exiting
    # cleanly, which pipefail then reports as a failure. Redirecting to
    # /dev/null instead lets grep drain the rest of the output first.
    check "color asks claude, reports the pass-cli skill, and snapshots to restic" bash -o pipefail -c \
        "color | tee /tmp/color-output.txt | grep -i 'pass-cli' >/dev/null"

    pass-cli logout || true
else
    echo -e "\nSkipping 'ask claude its favorite color' check: PROTON_PASS_PERSONAL_ACCESS_TOKEN not set.\n"
fi

# Report result
# If any of the checks above exited with a non-zero exit code, the test will fail.
reportResults
