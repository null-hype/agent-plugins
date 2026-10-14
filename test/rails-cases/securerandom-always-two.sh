#!/bin/bash
# A keyless replay of the CI-built Storybook, using only the selected fixtures.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
cd "$here"
npm install --ignore-scripts --no-audit --no-fund
fixtures="$here/securerandom-always-two"
pkl test -p hash=dbafc460fa -p case="$fixtures" "$here/Recordings.test.pkl"
bash "$here/recordings-failures.sh" "$fixtures" dbafc460fa
test -f "$fixtures/replay.har" || { echo "Export securerandom-always-two-har in CI before running this scenario" >&2; exit 1; }
"$here/replay.sh" "$fixtures/replay.har" securerandom-always-two always 'always 2'
pkl test -p hash=dbafc460fa -p case="$fixtures" -p word=always "$here/Replay.test.pkl"
