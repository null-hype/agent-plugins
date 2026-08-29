#!/bin/bash

# This test file will be executed against one of the scenarios devcontainer.json test that
# includes the 'playwright-cli' feature with "browser": "firefox" option.

set -e

# Optional: Import test library bundled with the devcontainer CLI
source dev-container-features-test-lib

# Feature-specific tests
# The 'check' command comes from the dev-container-features-test-lib.
check "playwright-cli is on PATH" bash -c "playwright-cli --version"
check "playwright-cli skill was installed" bash -c "test -f \$HOME/.claude/skills/playwright-cli/SKILL.md"

# Report results
# If any of the checks above exited with a non-zero exit code, the test will fail.
reportResults
