#!/bin/bash
# The ci-login Pass agent's token (no grants) reaches the container through
# remoteEnv, and pass-cli logs in with it.
set -e

source dev-container-features-test-lib

check "pass-cli logs in" pass-cli login
check "the session is the agent's token" bash -c "pass-cli info | grep 'Personal Access Token'"

reportResults
