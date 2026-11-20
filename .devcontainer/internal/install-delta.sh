#!/usr/bin/env bash
set -euo pipefail

# Install as the Codespace user so the Claude plugin can locate the CLI.
installer=$(mktemp)
trap 'rm -f "$installer"' EXIT
curl --fail --silent --show-error --location \
  https://delta.dev/install.sh -o "$installer"
delta_cli=$(sh "$installer" --non-interactive)
"$delta_cli" --version
