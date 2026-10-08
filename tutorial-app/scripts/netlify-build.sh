#!/usr/bin/env bash
# Netlify's Node image needs the same Pkl tool as the replay CI renderer.
set -euo pipefail
if command -v pkl >/dev/null 2>&1; then
  npm run build
else
  tools="$(mktemp -d)"
  trap 'rm -rf "$tools"' EXIT
  curl -fsSL https://github.com/apple/pkl/releases/download/0.32.1/pkl-linux-amd64 -o "$tools/pkl"
  chmod +x "$tools/pkl"
  PATH="$tools:$PATH" npm run build
fi
