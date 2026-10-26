#!/usr/bin/env bash
# Logs the planner into its own Pass session on this machine, as CI does
# (.github/workflows/delivery.yml), so a local run's accesses are the planner's
# and show in `pass-cli agent monitor jev-planner`. Run it logged in as yourself:
# the owner reads the planner's token where bootstrap.sh keeps it.
#
#   eval "$(bash delivery/login.sh)"
set -euo pipefail

dir="${XDG_STATE_HOME:-$HOME/.local/state}/jev-pass/planner"
mkdir -p "$dir"
# The token goes from Pass straight into the planner's login, as a ref: nothing
# here holds it.
if ! PROTON_PASS_SESSION_DIR="$dir" PROTON_PASS_KEY_PROVIDER=fs pass-cli info >/dev/null 2>&1; then
  PROTON_PASS_PERSONAL_ACCESS_TOKEN=pass://jev-root/planner-token/PROTON_PASS_PERSONAL_ACCESS_TOKEN \
  PROTON_PASS_AGENT_REASON="start the planner on this machine" \
    pass-cli run -- env PROTON_PASS_SESSION_DIR="$dir" PROTON_PASS_KEY_PROVIDER=fs pass-cli login >&2
fi
echo "export PASS_SESSION_PLANNER=$dir"
