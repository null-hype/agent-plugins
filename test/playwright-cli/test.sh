#!/bin/bash

# This test file will be executed against an auto-generated devcontainer.json that
# includes the 'playwright-cli' Feature with no options.
#
# For more information, see: https://github.com/devcontainers/cli/blob/main/docs/features/test.md
#
# Eg:
# {
#    "image": "<..some-base-image...>",
#    "features": {
#      "playwright-cli": {}
#    },
#    "remoteUser": "root"
# }
#
# Thus, the value of all options will fall back to the default value in
# the Feature's 'devcontainer-feature.json'.
# For the 'playwright-cli' feature, that means the default browser is 'chromium'.
#
# These scripts are run as 'root' by default. Although that can be changed
# with the '--remote-user' flag.
#
# This test can be run with the following command:
#
#    devcontainer features test \
#                   --features playwright-cli   \
#                   --remote-user root \
#                   --skip-scenarios   \
#                   --base-image mcr.microsoft.com/devcontainers/base:ubuntu \
#                   /path/to/this/repo

set -e

# Optional: Import test library bundled with the devcontainer CLI
# See https://github.com/devcontainers/cli/blob/HEAD/docs/features/test.md#dev-container-features-test-lib
# Provides the 'check' and 'reportResults' commands.
source dev-container-features-test-lib

# Feature-specific tests
# The 'check' command comes from the dev-container-features-test-lib. Syntax is...
# check <LABEL> <cmd> [args...]
check "playwright-cli is on PATH" bash -c "playwright-cli --version"
check "playwright-cli skill was installed" bash -c "test -f \$HOME/.claude/skills/playwright-cli/SKILL.md"

# Report results
# If any of the checks above exited with a non-zero exit code, the test will fail.
reportResults
