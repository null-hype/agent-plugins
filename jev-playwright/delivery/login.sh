#!/usr/bin/env bash
# Logs the planner and the judge into their own Pass sessions on this machine, as
# CI does (.github/workflows/delivery.yml), so a local run's accesses are theirs
# and show in `pass-cli agent monitor`. Run it logged in as yourself: the owner
# reads each token where bootstrap.sh keeps it.
#
#   eval "$(bash delivery/login.sh)"
set -euo pipefail

login() { # role ref
  local dir="${XDG_STATE_HOME:-$HOME/.local/state}/jev-pass/$1"
  mkdir -p "$dir"
  # The token goes from Pass straight into the agent's login, as a ref: nothing
  # here holds it.
  if ! PROTON_PASS_SESSION_DIR="$dir" PROTON_PASS_KEY_PROVIDER=fs pass-cli info >/dev/null 2>&1; then
    PROTON_PASS_PERSONAL_ACCESS_TOKEN="$2" PROTON_PASS_AGENT_REASON="start the $1 on this machine" \
      pass-cli run -- env PROTON_PASS_SESSION_DIR="$dir" PROTON_PASS_KEY_PROVIDER=fs pass-cli login >&2
  fi
  echo "export PASS_SESSION_${1^^}=$dir"
}

login planner pass://jev-root/planner-token/PROTON_PASS_PERSONAL_ACCESS_TOKEN
login judge pass://jev-owner/JEV_JUDGE_PASS_TOKEN/JEV_JUDGE_PASS_TOKEN
