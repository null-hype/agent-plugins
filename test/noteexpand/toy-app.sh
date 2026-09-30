#!/bin/bash
set -e
source dev-container-features-test-lib

check "detector flags the positive toy application; mock Jev receives its state" \
    /usr/local/lib/noteexpand/venv/bin/python "$SCRIPT_FOLDER/noteexpand_test.py" --jev
check "detector accepts the control toy application; mock Jev receives its state" \
    /usr/local/lib/noteexpand/venv/bin/python "$SCRIPT_FOLDER/noteexpand_test.py" --control --jev
reportResults
