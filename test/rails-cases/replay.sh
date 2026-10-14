#!/usr/bin/env bash
# CIT-401: replay one story as a user, with Playwright Test.
#
#   replay.sh <har> <story> <word> <phrase>
#     e.g. replay.sh replay.har securerandom-always-two always 'always 2'
#
# With STORYBOOK_URL set, the story is opened on that Storybook and every
# response is recorded into <har>. Without it, responses come from <har> only.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
har=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
export REPLAY_HAR=$har REPLAY_STORY=$2 REPLAY_WORD=$3 REPLAY_PHRASE=$4
cd "$here"
exec npx --no-install playwright test
