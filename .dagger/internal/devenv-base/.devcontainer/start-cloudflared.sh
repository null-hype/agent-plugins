#!/usr/bin/env bash
# Start cloudflared, tunnelling agent.tidelands.dev to the linear-agent
# webhook server on :8080. Fronts the app with Cloudflare's own cert instead
# of tailscale funnel's -- funnel's cert is only valid for the raw
# <hostname>.<tailnet>.ts.net name, and Cloudflare Origin Rules' SNI/Host
# override (the fix that would've let Cloudflare proxy straight to that
# funnel origin under agent.tidelands.dev) turned out to be plan-gated. A
# tunnel sidesteps that entirely: cloudflared makes an outbound connection
# to Cloudflare, so there's no origin TLS cert to match at all.
#
# The tunnel itself (id, ingress config routing agent.tidelands.dev ->
# http://localhost:8080, and the DNS CNAME to <tunnel-id>.cfargotunnel.com)
# is already provisioned via the Cloudflare API -- this script only needs to
# get the connector running. Idempotent (process check via pgrep) and
# backgrounded (nohup + disown) so it survives the SSH session that invoked
# this, matching tailscale-up.sh/start-linear-agent.sh.
set -euo pipefail

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo > /dev/null 2>&1; then
    SUDO="sudo"
  else
    echo "sudo is required to run as a non-root user but was not found" >&2
    exit 1
  fi
fi

export PROTON_PASS_KEY_PROVIDER=${PROTON_PASS_KEY_PROVIDER:-fs}
export PROTON_PASS_AGENT_REASON="start-cloudflared: fetch tunnel token"

ENV_FILE="$(dirname "${BASH_SOURCE[0]}")/cloudflared.env"

if ! command -v cloudflared >/dev/null 2>&1; then
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$(dpkg --print-architecture)" -o /tmp/cloudflared
  chmod +x /tmp/cloudflared
  $SUDO mv /tmp/cloudflared /usr/local/bin/cloudflared
fi

if pgrep -f "cloudflared tunnel run" > /dev/null 2>&1; then
  echo "cloudflared: already running"
else
  pass-cli run --env-file "$ENV_FILE" -- bash -c '
    set -euo pipefail
    : "${CLOUDFLARE_TUNNEL_TOKEN:?CLOUDFLARE_TUNNEL_TOKEN not resolved from Pass}"
    nohup cloudflared tunnel run --token "$CLOUDFLARE_TUNNEL_TOKEN" > /tmp/cloudflared.log 2>&1 &
    disown
  '
  for _ in $(seq 1 20); do
    pgrep -f "cloudflared tunnel run" > /dev/null 2>&1 && break
    sleep 0.5
  done
  echo "cloudflared: started"
fi
