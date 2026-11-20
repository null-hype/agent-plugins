#!/bin/bash
set -e
source dev-container-features-test-lib

check "runs as the configured remote user" test "$(id -un)" = vscode
check "Delta is on the remote user's PATH" command -v delta
check "Delta runs on Debian 13" delta --version

reportResults
