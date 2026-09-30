#!/bin/bash
# Rules T/S/C1/C2/C4/C5/D4/V: test installed features with baked fixtures.
set -e
source dev-container-features-test-lib
S=/opt/scenarios/cit-286-contract
export CONTRACT_RECORDS_DIR="${SCRIPT_FOLDER:-/tmp}/contract-records"
check "typed seam fixture (Pkl facts and golden example)" \
    pkl test --module-path /usr/local/share/evidence/pkl:/usr/local/share/jev/pkl "$S/cit-286-contract.test.pkl"
check "ground before Jev, capture input, mock response" \
    /usr/local/lib/evidence/venv/bin/python "$S/cit-286-contract_test.py"
reportResults
