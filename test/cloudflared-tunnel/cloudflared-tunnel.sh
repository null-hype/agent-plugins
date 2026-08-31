#!/bin/bash

# This test file will be executed against the scenario devcontainer.json test that
# includes the 'cloudflared-tunnel' feature with custom option values.

set -e

# Optional: Import test library bundled with the devcontainer CLI
source dev-container-features-test-lib

# Feature-specific tests
# The 'check' command comes from the dev-container-features-test-lib.
check "cloudflared is on PATH" bash -c "cloudflared --version"
check "start-cloudflared-tunnel bin was installed" bash -c "test -x /usr/local/bin/start-cloudflared-tunnel"
check "cloudflared.env was written with the scenario's token secret path" bash -c "grep -q 'CLOUDFLARE_TUNNEL_TOKEN=pass://development/example/CLOUDFLARE_TUNNEL_TOKEN' /etc/cloudflared-tunnel/cloudflared.env"
check "start-cloudflared-tunnel embeds the scenario's hostname/port/tunnel id" bash -c "grep -q 'example.test' /usr/local/bin/start-cloudflared-tunnel && grep -q '9090' /usr/local/bin/start-cloudflared-tunnel && grep -q 'test-tunnel-id' /usr/local/bin/start-cloudflared-tunnel"

# Report results
# If any of the checks above exited with a non-zero exit code, the test will fail.
reportResults
