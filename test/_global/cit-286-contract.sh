#!/bin/bash

# CIT-286 deterministic contract scenario (global): reasoning model -> Jev.
#
# Built by 'devcontainer features test --global-scenarios-only .' from the
# 'cit-286-contract' entry in scenarios.json (Dockerfile in cit-286-contract/,
# features: evidence, jev). The scenario itself is defined in Pkl
# (cit-286-contract/cit-286-contract.pkl); cit-286-contract_test.py loads it and
# executes collection, grounding, the evidence-to-Jev transform, the installed
# jev client and the assertions.
#
# Mode: deterministic, chosen explicitly below -- canned evidence, mock Jev, zero
# real calls, no credentials read. The live modes are reported NOT RUN; they run
# only from the dedicated manual workflow (see src/evidence/README.md).
#
# Self-contained (skill Rule S): the Pkl files and driver were baked into the
# image at /opt/scenarios/cit-286-contract by the Dockerfile; nothing is read
# from the checkout.

set -e

source dev-container-features-test-lib

S=/opt/scenarios/cit-286-contract
# Evaluation records (evaluations.jsonl + preserved worlds) are written under the
# bind-mounted script folder so they survive the container and can be exported
# as CI artifacts on pass and fail alike.
export CONTRACT_RECORDS_DIR="${SCRIPT_FOLDER:-/tmp}/contract-records"

check "pkl runtime installed"           pkl --version
check "evidence-validate on PATH"       bash -c "command -v evidence-validate"
check "jev on PATH"                     bash -c "jev --help >/dev/null"
check "Evidence.pkl installed"          test -f /usr/local/share/evidence/pkl/Evidence.pkl
check "scenario invariants hold (pkl test, incl. controlled golden example)" \
    pkl test --module-path /usr/local/share/evidence/pkl "$S/cit-286-contract.test.pkl"
check "deterministic scenario: all checks pass, zero real calls" \
    python3 "$S/cit-286-contract_test.py" --mode deterministic --report-live

reportResults
