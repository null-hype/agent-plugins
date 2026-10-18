#!/bin/bash

# Default installation: the Codex CLI and the codex-session bin are on PATH.
# Nothing here touches restic or a login -- see linear-agent-review.sh.
#
#    devcontainer features test -f codex-session --skip-scenarios -i ubuntu:latest .

set -e

source dev-container-features-test-lib

check "codex is installed" codex --version
check "codex-session prints its usage" bash -c "codex-session 2>&1 | grep -q 'codex-session review'"

reportResults
