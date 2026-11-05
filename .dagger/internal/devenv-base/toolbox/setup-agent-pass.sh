#!/usr/bin/env bash
# Sets up the Linear agent workspace's own Proton Pass identity: the agent
# linear-agent-host, a Pass agent so `pass-cli agent monitor linear-agent-host`
# shows every secret the workspace read and the reason it gave. It can view
# only the items the workspace's start scripts read:
#
#   infra/tailscale               tailscale-up.sh
#   infra/cloudflare              start-cloudflared.sh
#   tidelands.dev/agent           start-linear-agent.sh, check-linear-agent-webhook-live.sh
#   tidelands.dev/openrouter-agent start-openrouter-agent.sh, check-linear-agent-webhook-live.sh
#
# Its token is kept in tidelands.dev/linear-agent-host, which the agent itself
# cannot read, and in the toolbox's Render secret LINEAR_AGENT_PASS_TOKEN,
# which agent_start sends to the workspace's tailscale-up.sh. A token whose
# item grants show no vaults cannot resolve that item by name on the host, so
# the toolbox holds it. Run it logged in as yourself; re-running reuses what
# exists.
#
#   bash toolbox/setup-agent-pass.sh
set -euo pipefail

AGENT="${AGENT:-linear-agent-host}"
EXPIRATION="${EXPIRATION:-1y}"   # 1d, 1w, 1m, 3m, 6m or 1y
TOKEN_VAULT="${TOKEN_VAULT:-tidelands.dev}"

die() { echo "setup-agent-pass: $*" >&2; exit 1; }
command -v pass-cli >/dev/null 2>&1 || die "pass-cli is required"
command -v jq >/dev/null 2>&1 || die "jq is required"

# `personal-access-token list` is refused in a token session, so it doubles as the owner check.
pass-cli personal-access-token list --output json >/dev/null 2>&1 ||
  die "run it logged in as yourself, not as a token: pass-cli login"
export PROTON_PASS_AGENT_REASON="set up the $AGENT Pass agent for the Linear agent workspace"

agent_exists() {
  pass-cli agent list --output json | jq -e --arg n "$1" '.. | objects | select(.name? == $n)' >/dev/null
}
item_exists() {
  pass-cli item list "$1" --output json |
    jq -e --arg t "$2" '.. | objects | select((.title? == $t) or (.content?.title? == $t))' >/dev/null
}

# The token is printed once, by `agent create`, so it goes straight into its
# item and is never echoed or written to a file.
if agent_exists "$AGENT"; then
  echo "agent exists: $AGENT"
  item_exists "$TOKEN_VAULT" "$AGENT" ||
    die "$AGENT exists but its token is not in $TOKEN_VAULT/$AGENT: renew it (pass-cli agent renew $AGENT) into that item"
else
  item_exists "$TOKEN_VAULT" "$AGENT" &&
    die "$TOKEN_VAULT/$AGENT exists but $AGENT does not: delete that item and run again"
  echo "creating agent: $AGENT ($EXPIRATION)"
  pass-cli agent create "$AGENT" --expiration "$EXPIRATION" |
    jq -e --arg title "$AGENT" '.token // error("agent create printed no token") |
      {title: $title, note: "Pass token of the Pass agent \($title); see toolbox/setup-agent-pass.sh",
       sections: [{section_name: $title, fields: [{field_name: "PROTON_PASS_PERSONAL_ACCESS_TOKEN", field_type: "hidden", value: .}]}]}' |
    pass-cli item create custom --vault-name "$TOKEN_VAULT" --from-template - >/dev/null
  echo "stored: $TOKEN_VAULT/$AGENT/PROTON_PASS_PERSONAL_ACCESS_TOKEN"
fi

# Granting an item the agent can already view is refused as NotAllowed, and
# pass-cli cannot list an agent's grants, so on a re-run that is reported,
# not treated as an error.
grant() { # vault item
  local err
  err="$(mktemp)"
  if pass-cli agent access grant "$AGENT" --vault-name "$1" --item-title "$2" --role viewer 2>"$err"; then
    rm -f "$err"; echo "granted: $AGENT viewer $1/$2"; return 0
  fi
  if grep -Eqi 'already|duplicate|NotAllowed' "$err"; then
    rm -f "$err"; echo "not granted again (already granted?): $AGENT viewer $1/$2"; return 0
  fi
  cat "$err" >&2; rm -f "$err"; return 1
}
grant infra tailscale
grant infra cloudflare
grant tidelands.dev agent
grant tidelands.dev openrouter-agent
