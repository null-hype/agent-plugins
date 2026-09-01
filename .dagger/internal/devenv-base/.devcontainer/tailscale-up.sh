#!/usr/bin/env bash
# Bring up tailscaled (no systemd in this image) and join the tailnet using
# an auth key pulled from Proton Pass. Idempotent; run via postStartCommand
# on every container start.
set -euo pipefail

TS_HOSTNAME=${TS_HOSTNAME:-tidelands}
STATE_DIR=/var/lib/tailscale
SOCK=/var/run/tailscale/tailscaled.sock

export PROTON_PASS_KEY_PROVIDER=${PROTON_PASS_KEY_PROVIDER:-fs}
export PROTON_PASS_AGENT_REASON=${PROTON_PASS_AGENT_REASON:-"tailscale-up: fetch Tailscale auth key"}

if ! pass-cli info > /dev/null 2>&1; then
  if [ -z "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:-}" ]; then
    echo "PROTON_PASS_PERSONAL_ACCESS_TOKEN is not set and no pass-cli session exists; cannot join tailnet." >&2
    exit 1
  fi
  pass-cli logout --force
  pass-cli login
fi

if ! pgrep -x tailscaled > /dev/null 2>&1; then
  sudo mkdir -p "$STATE_DIR" "$(dirname "$SOCK")"
  sudo nohup tailscaled --state="$STATE_DIR/tailscaled.state" --socket="$SOCK" \
    > /tmp/tailscaled.log 2>&1 &
  for _ in $(seq 1 20); do
    [ -S "$SOCK" ] && break
    sleep 0.5
  done
fi

if sudo tailscale --socket="$SOCK" status > /dev/null 2>&1; then
  echo "tailscale: already connected"
else
  TS_ENV_FILE="$(dirname "${BASH_SOURCE[0]}")/tailscale.env"
  export SOCK TS_HOSTNAME
  pass-cli run --env-file "$TS_ENV_FILE" -- \
    sh -c 'exec sudo tailscale --socket="$SOCK" up --authkey="$TS_AUTHKEY" --hostname="$TS_HOSTNAME" --accept-routes --ssh'
  echo "tailscale: joined tailnet as $TS_HOSTNAME"
fi
