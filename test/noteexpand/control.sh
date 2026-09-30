#!/bin/bash
set -e
source dev-container-features-test-lib

check "control canary and evidence match Pkl expectations" \
    /usr/local/lib/noteexpand/venv/bin/python "$SCRIPT_FOLDER/noteexpand_test.py" --control
reportResults
