#!/usr/bin/env bash
# Every rule's message must be a principle heading in AGENTS.md.
set -euo pipefail
shopt -s nullglob
cd "$(dirname "$0")/.."
status=0
rules=(rules/*.yml)
for rule in "${rules[@]}"; do
  message=$(sed -n 's/^message: //p' "$rule")
  if ! grep -qxF "### $message" AGENTS.md; then
    echo "$rule: message is not a heading in AGENTS.md: $message" >&2
    status=1
  fi
done
if [ "$status" -eq 0 ]; then
  principles=$(awk '/^## Review guidelines/{flag=1; next} /^## /{flag=0} flag && /^### /{c++} END{print c+0}' AGENTS.md)
  echo "check-organs: ${#rules[@]} rule(s) checked against $principles principle(s)"
fi
exit $status
