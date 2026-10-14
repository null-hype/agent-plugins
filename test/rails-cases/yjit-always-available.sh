#!/bin/bash
# A keyless replay of the CI-built Storybook, using only the selected fixtures.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
cd "$here"
npm install --ignore-scripts --no-audit --no-fund
fixtures="$here/yjit-always-available"
pkl test -p hash=fddf74bea9 -p case="$fixtures" "$here/Recordings.test.pkl"
bash "$here/recordings-failures.sh" "$fixtures" fddf74bea9
test -f "$fixtures/replay.har" || { echo "Export yjit-always-available-har in CI before running this scenario" >&2; exit 1; }
"$here/replay.sh" "$fixtures/replay.har" yjit-always-available always 'always available'
pkl test -p hash=fddf74bea9 -p case="$fixtures" -p word=always "$here/Replay.test.pkl"
