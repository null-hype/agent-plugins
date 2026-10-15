#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
scenario=$(basename "$0" .sh)
# Generate into a fresh directory so browser-exported snapshots remain intact.
fixtures=$(mktemp -d)
trap 'rm -rf "$fixtures"' EXIT
cp "$scenario/commit.txt" "$fixtures/"
pkl eval -m "$fixtures" "$scenario/Fixtures.pkl"
pkl test -p hash="${RAILS_CASE_HASH:?}" -p case="$fixtures" \
    Recordings.test.pkl "$scenario/Confidence.test.pkl"
