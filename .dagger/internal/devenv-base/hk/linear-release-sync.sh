#!/usr/bin/env bash
# Syncs the current push to the Linear "Development" release. Base ref is
# left to linear-release's automatic baseline selection -- it tracks the
# last synced commit itself once a baseline exists (see hk.pkl's post-push
# hook).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export PROTON_PASS_AGENT_REASON="placeholder"
pass-cli run --env-file "$DIR/../linear-release.env" -- \
  linear-release sync --name "Development"
