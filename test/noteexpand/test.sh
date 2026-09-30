#!/bin/bash
set -e
source dev-container-features-test-lib

check "noteexpand application installed" test -x /opt/toy/service.sh
check "Pkl contract installed" test -f /usr/local/share/noteexpand/pkl/Evidence.pkl
check "positive canary and evidence match Pkl expectations" \
    /usr/local/lib/noteexpand/venv/bin/python "$SCRIPT_FOLDER/noteexpand_test.py"
reportResults
