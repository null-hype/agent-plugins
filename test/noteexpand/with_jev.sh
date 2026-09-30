#!/bin/bash
set -e
source dev-container-features-test-lib

check "installed noteexpand evidence reaches installed mock Jev" \
    /usr/local/lib/noteexpand/venv/bin/python "$SCRIPT_FOLDER/noteexpand_test.py" --jev
reportResults
