#!/usr/bin/env bash
# Syncs the current push to the Linear "Development" release. Base ref is
# left to linear-release's automatic baseline selection -- it tracks the
# last synced commit itself once a baseline exists. Runs under hk's "check"
# hook (not pre-push) -- see hk.pkl.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(basename "$(git -C "$DIR" rev-parse --show-toplevel)")"
BRANCH="$(git -C "$DIR" rev-parse --abbrev-ref HEAD)"

export PROTON_PASS_AGENT_REASON="linear-release-sync hook: repo=$REPO branch=$BRANCH"
pass-cli run --env-file "$DIR/../linear-release.env" -- \
  linear-release sync --name "Development"
