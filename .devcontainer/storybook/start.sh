#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../tutorial-app"

pid_file=/tmp/tidelands-storybooks.pid
if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
  echo "Storybooks already running; logs: /tmp/tidelands-storybooks.log"
  exit 0
fi
nohup node scripts/start-storybooks.mjs > /tmp/tidelands-storybooks.log 2>&1 < /dev/null &
echo "$!" > "$pid_file"
echo "Starting Storybooks on 7880 and 7881; logs: /tmp/tidelands-storybooks.log"
