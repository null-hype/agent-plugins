#!/bin/bash
set -e
source dev-container-features-test-lib
check "RAILS_CASES_HOME is set" test -n "$RAILS_CASES_HOME"
check "the Pkl modules are installed" test -f "$RAILS_CASES_HOME/Payloads.pkl"
check "the experiment ontology is installed" test -f "$RAILS_CASES_HOME/experiment/Experiment.pkl"
check "the experiment command is installed" rails-experiment --help
reportResults
