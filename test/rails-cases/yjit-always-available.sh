#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
scenario=$(basename "$0" .sh)
# A supplied capture is consumed directly; the default is the retained real run.
if [ -n "${RAILS_CASE_EVIDENCE:-}" ]; then
    fixtures=$(cd "$RAILS_CASE_EVIDENCE" && pwd)
else
    fixtures=$(mktemp -d)
    trap 'rm -rf "$fixtures"' EXIT
    cp "$scenario/commit.txt" "$fixtures/"
    pkl eval -m "$fixtures" "$scenario/Fixtures.pkl"
fi
pkl eval -p case="$fixtures" -o "$fixtures/recordings.json" \
    /usr/local/share/rails-cases/Recordings.pkl
# Render before checking the hypothesis: a disagreement remains inspectable.
pkl eval -p hash="${RAILS_CASE_HASH:?}" -p case="$fixtures" \
    -o "$fixtures/frame.json" /usr/local/share/rails-cases/Frame.pkl
pkl test -p hash="${RAILS_CASE_HASH:?}" -p case="$fixtures" \
    Recordings.test.pkl "$scenario/Confidence.test.pkl"
