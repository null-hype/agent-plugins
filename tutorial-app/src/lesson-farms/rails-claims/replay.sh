#!/usr/bin/env bash
# CIT-397: replay the story as a user would, with playwright-cli, and keep the
# trace as cases/<hash>/replay.trace. Replay.pkl reads the keyframes from it.
#
#   replay.sh <hash>      (Storybook serving on $STORYBOOK_URL, default :6006)
#
# The story is opened with embed=true, so its play function does not run:
# every step below is the user's, not the story's.
set -euo pipefail
hash=$1
here=$(cd "$(dirname "$0")" && pwd)
cli=${PLAYWRIGHT_CLI:-$here/../../../node_modules/.bin/playwright-cli}
url=${STORYBOOK_URL:-http://127.0.0.1:6006}
work=$(mktemp -d)
cd "$work"
pw() { "$cli" -s="replay-$hash" "$@" >/dev/null; }
wait_for() { pw run-code "async page => { await page.$1.waitFor(); }"; }

pw open
pw tracing-start
# 1. Open the story.
pw goto "$url/iframe.html?id=investigations-rails-commit-claims--the-frame-the-evidence-supports&viewMode=story&embed=true"
wait_for "getByRole('button', { name: /Jev/ }).first()"
pw snapshot
# 2. Point at a flagged word.
pw hover "text=always available"
wait_for "getByRole('tooltip')"
pw snapshot
# 3. Follow its Jev lens.
pw click "getByRole('button', { name: /always · Jev/ })"
wait_for "getByText('not sent yet')"
pw snapshot
# 4. Go back to the commit message.
pw click "getByRole('button', { name: '↑ COMMIT_EDITMSG' })"
wait_for "getByRole('button', { name: /Jev/ }).first()"
pw snapshot
pw tracing-stop
pw close

cp .playwright-cli/traces/*.trace "$here/cases/$hash/replay.trace"
rm -rf "$work"
