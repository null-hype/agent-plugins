#!/bin/bash
# A keyless replay of the CI-built Storybook, using only the selected fixtures.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
fixtures="$here/securerandom-always-two"
pkl test -p hash=dbafc460fa -p case="$fixtures" "$RAILS_CASES_HOME/Recordings.test.pkl"
test -f "$fixtures/replay.har" || { echo "Export securerandom-always-two-har in CI before running this scenario" >&2; exit 1; }
"$RAILS_CASES_HOME/replay.sh" "$fixtures/replay.har" securerandom-always-two always 'always 2'
pkl test -p hash=dbafc460fa -p case="$fixtures" -p word=always "$RAILS_CASES_HOME/Replay.test.pkl"
