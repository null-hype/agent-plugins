#!/bin/bash
# A keyless replay of the CI-built Storybook, using only the selected fixtures.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
fixtures="$here/yjit-always-available"
pkl test -p hash=fddf74bea9 -p case="$fixtures" "$RAILS_CASES_HOME/Recordings.test.pkl"
bash "$here/recordings-failures.sh" "$fixtures" fddf74bea9
test -f "$fixtures/replay.har" || { echo "Export yjit-always-available-har in CI before running this scenario" >&2; exit 1; }
"$RAILS_CASES_HOME/replay.sh" "$fixtures/replay.har" yjit-always-available always 'always available'
pkl test -p hash=fddf74bea9 -p case="$fixtures" -p word=always "$RAILS_CASES_HOME/Replay.test.pkl"
