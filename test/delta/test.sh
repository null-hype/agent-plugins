#!/bin/bash
set -e
source dev-container-features-test-lib

check "Delta is on PATH" command -v delta
check "Delta runs" delta --version

reportResults
