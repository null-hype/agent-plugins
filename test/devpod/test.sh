#!/bin/bash

# This test file will be executed against an auto-generated devcontainer.json
# that includes the 'devpod' Feature with no options.
#
# For more information, see: https://github.com/devcontainers/cli/blob/main/docs/features/test.md
#
# This test can be run with the following command:
#
#    devcontainer features test    \
#               --features devpod   \
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
check "env file installed at fixed path" bash -c "test -f \$HOME/.agent/skills/devpod/.env"
check "gcp service account key resolves via pass" grep 'GCP_SERVICE_ACCOUNT_KEY=pass://JIN-63/restic/GCP_SERVICE_ACCOUNT_KEY' "$HOME/.agent/skills/devpod/.env"
check "github token resolves via pass" grep 'GITHUB_TOKEN=pass://JIN-63/gh/GITHUB_TOKEN' "$HOME/.agent/skills/devpod/.env"
check "no plaintext secret values baked in" bash -c "! grep -vE '^[A-Z_]+=pass://' \$HOME/.agent/skills/devpod/.env"

# Report result
# If any of the checks above exited with a non-zero exit code, the test will fail.
reportResults
