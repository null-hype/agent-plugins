#!/bin/bash
set -e
source dev-container-features-test-lib

check "detector installed" noteexpand-detect --help
check "feature does not install the toy app" test ! -e /opt/toy/service.sh

TASK_DIR=$(mktemp -d)
printf '%s' '{"findings":[]}' > "$TASK_DIR/claim.json"
printf '%s' '{"factID":"default","snapshotRef":"fixture:default","outsideRead":false,"plainLinesRendered":true}' > "$TASK_DIR/observation.json"
check "typed empty claim and observation produce no flags" bash -c \
    'test "$(noteexpand-detect "$1/claim.json" "$1/observation.json")" = "[]"' _ "$TASK_DIR"
printf '%s' '{"findings":"invalid"}' > "$TASK_DIR/invalid.json"
check "malformed evidence is rejected by Pkl" bash -c \
    '! noteexpand-detect "$1/invalid.json" "$1/observation.json"' _ "$TASK_DIR"
reportResults
