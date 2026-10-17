#!/usr/bin/env bash
# Every rule's message must be a principle heading in AGENTS.md.
set -euo pipefail
cd "$(dirname "$0")/.."
status=0
for rule in rules/*.yml; do
  message=$(sed -n 's/^message: //p' "$rule")
  if ! grep -qxF "### $message" AGENTS.md; then
    echo "$rule: message is not a heading in AGENTS.md: $message" >&2
    status=1
  fi
done
exit $status
