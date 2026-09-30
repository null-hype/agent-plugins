#!/bin/bash
# Rules T/S/C/D4/V: run a concrete case, with recorded claims and mock Jev.
set -e
source dev-container-features-test-lib
S=/opt/scenarios/cit-286-toy-smoke
export CONTRACT_RECORDS_DIR="${SCRIPT_FOLDER:-/tmp}/contract-records"
check "known composition disagreements (Pkl facts and golden example)" \
    pkl test --module-path /usr/local/share/evidence/pkl:/usr/local/share/jev/pkl "$S/cit-286-toy-smoke.test.pkl"
check "observed canary reconciles with the claim; raw Jev response retained" \
    /usr/local/lib/evidence/venv/bin/python "$S/cit-286-toy-smoke_test.py"
reportResults
