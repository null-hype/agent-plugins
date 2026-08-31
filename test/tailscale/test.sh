#!/bin/bash

# This test file will be executed against an auto-generated devcontainer.json
# that includes the 'tailscale' Feature with no options.
#
# For more information, see: https://github.com/devcontainers/cli/blob/main/docs/features/test.md
#
# This test can be run with the following command:
#
#    devcontainer features test    \
#               --features tailscale   \
#               --remote-user root \
#               --skip-scenarios   \
#               --base-image mcr.microsoft.com/devcontainers/base:ubuntu \
#               /path/to/this/repo

set -e

# Optional: Import test library bundled with the devcontainer CLI
# See https://github.com/devcontainers/cli/blob/HEAD/docs/features/test.md#dev-container-features-test-lib
# Provides the 'check' and 'reportResults' commands.
source dev-container-features-test-lib

# Feature-specific tests
# The 'check' command comes from the dev-container-features-test-lib. Syntax is...
# check <LABEL> <cmd> [args...]
check "tailscale binary installed" bash -c "command -v tailscale"
check "tailscale-up bin installed" bash -c "command -v tailscale-up"
check "auth key env file baked in with default path" grep 'TS_AUTHKEY=pass://development/rant.local/TS_AUTHKEY' /usr/local/etc/tailscale-up.env

# Report result
# If any of the checks above exited with a non-zero exit code, the test will fail.
reportResults
