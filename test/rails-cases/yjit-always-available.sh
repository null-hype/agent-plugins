#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
# The matching scenario directory is copied by the feature test runner.
scenario=$(basename "$0" .sh)
pkl eval -m "$scenario" "$scenario/Fixtures.pkl"
pkl test -p hash="${RAILS_CASE_HASH:?}" -p case="$PWD/$scenario" \
    Recordings.test.pkl "$scenario/Confidence.test.pkl"
