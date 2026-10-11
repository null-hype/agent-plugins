#!/usr/bin/env bash
# CIT-397: replay the story as a user would, with playwright-cli, and keep the
# trace as cases/<hash>/replay.trace. Replay.pkl reads the keyframes from it.
#
#   replay.sh <hash> <story> <word> <phrase>
#     e.g. replay.sh fddf74bea9 yjit-always-available always 'always available'
#     (Storybook serving on $STORYBOOK_URL, default :6006)
#
# The story is opened with embed=true, so its play function does not run:
# every step below is the user's, not the story's.
set -euo pipefail
hash=$1 story=$2 word=$3 phrase=$4
here=$(cd "$(dirname "$0")" && pwd)
cli=${PLAYWRIGHT_CLI:-$here/../../../node_modules/.bin/playwright-cli}
url=${STORYBOOK_URL:-http://127.0.0.1:6006}
work=$(mktemp -d)
cd "$work"
# Quiet unless a command fails; playwright-cli reports errors on stdout.
pw() { local out; out=$("$cli" -s="replay-$hash" "$@" 2>&1) || { echo "playwright-cli $1: $out" >&2; return 1; }; }
wait_for() { pw run-code "async page => { await page.$1.waitFor(); }"; }
# Chromium, not playwright-cli's default Chrome channel (none on linux/arm64).
mkdir .playwright
echo '{"browser":{"browserName":"chromium","launchOptions":{"channel":"chromium"}}}' > .playwright/cli.config.json

pw open
pw tracing-start
# 1. Open the story.
pw goto "$url/iframe.html?id=investigations-rails-commit-claims--$story&viewMode=story&embed=true"
wait_for "getByRole('button', { name: /Jev/ }).first()"
pw snapshot
# 2. Point at the flagged word, on the line the phrase picks out. A line is
# one span, so hovering the phrase itself would land mid-line.
pw run-code "async page => {
  const line = page.locator('.view-line', { hasText: '$phrase' });
  const position = await line.evaluate((el, word) => {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode());) {
      const i = n.textContent.indexOf(word);
      if (i < 0) continue;
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + word.length);
      const w = r.getBoundingClientRect(), l = el.getBoundingClientRect();
      return { x: w.x - l.x + w.width / 2, y: w.y - l.y + w.height / 2 };
    }
    throw new Error('no ' + word + ' on the line');
  }, '$word');
  await line.hover({ position });
}"
wait_for "getByRole('tooltip')"
pw snapshot
# 3. Follow its Jev lens.
pw click "getByRole('button', { name: /$word · Jev/ })"
wait_for "getByText('pinned before the call')"
pw snapshot
# 4. Go back to the commit message.
pw click "getByRole('button', { name: '↑ COMMIT_EDITMSG' })"
wait_for "getByRole('button', { name: /Jev/ }).first()"
pw snapshot
pw tracing-stop
pw close

cp .playwright-cli/traces/*.trace "$here/cases/$hash/replay.trace"
rm -rf "$work"
