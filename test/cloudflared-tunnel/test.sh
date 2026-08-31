#!/bin/bash

# This test file will be executed against an auto-generated devcontainer.json that
# includes the 'cloudflared-tunnel' Feature with no options.
#
# For more information, see: https://github.com/devcontainers/cli/blob/main/docs/features/test.md
#
# Eg:
# {
#    "image": "<..some-base-image...>",
#    "features": {
#      "cloudflared-tunnel": {}
#    },
#    "remoteUser": "root"
# }
#
# Thus, the value of all options will fall back to the default value in
# the Feature's 'devcontainer-feature.json'.
#
# These scripts are run as 'root' by default. Although that can be changed
# with the '--remote-user' flag.
#
# This test can be run with the following command:
#
#    devcontainer features test \
#                   --features cloudflared-tunnel   \
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
check "cloudflared is on PATH" bash -c "cloudflared --version"
check "start-cloudflared-tunnel bin was installed" bash -c "test -x /usr/local/bin/start-cloudflared-tunnel"
check "cloudflared.env was written with the default token secret path" bash -c "grep -q 'CLOUDFLARE_TUNNEL_TOKEN=pass://development/cloudflare/CLOUDFLARE_TUNNEL_TOKEN' /etc/cloudflared-tunnel/cloudflared.env"

# Report results
# If any of the checks above exited with a non-zero exit code, the test will fail.
reportResults
