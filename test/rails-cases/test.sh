#!/bin/bash
set -e
source dev-container-features-test-lib
check "RAILS_CASES_HOME is set" test -n "$RAILS_CASES_HOME"
check "replay.sh is installed" test -x "$RAILS_CASES_HOME/replay.sh"
check "the Pkl modules are installed" test -f "$RAILS_CASES_HOME/Payloads.pkl"
check "@playwright/test is installed" test -d "$RAILS_CASES_HOME/node_modules/@playwright/test"
reportResults
