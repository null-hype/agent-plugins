#!/bin/bash

# Default installation of the 'protondrive' feature with no options.
#
#    devcontainer features test -f protondrive -i ubuntu:latest --skip-scenarios --skip-duplicated .

set -e

source dev-container-features-test-lib

check "proton-drive is on PATH" bash -c "command -v proton-drive"
check "proton-drive is the pinned release" bash -c "proton-drive version | grep -F 0.9.0"
check "session store is pass" bash -c '[ "$PROTON_DRIVE_CREDENTIALS_STORE" = pass ]'
check "pass is installed" bash -c "command -v pass"
check "gpg is installed" bash -c "command -v gpg"

reportResults
