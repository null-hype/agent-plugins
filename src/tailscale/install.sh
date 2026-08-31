#!/bin/sh
set -e

echo "Activating feature 'tailscale'"

# Install the tailscale client binaries if they aren't already on PATH
# (the Dagger `Tailscale` function in .dagger/main.go bakes these into
# built images the same way; this covers the devcontainer/dev-time path).
if ! command -v tailscale >/dev/null 2>&1; then
    curl -fsSL https://tailscale.com/install.sh | sh
fi

# Drop the join script as a bin on PATH, parameterized by this feature's
# options. Ported from devenv-base/.devcontainer/tailscale-up.sh: bring up
# tailscaled (no systemd in devcontainer images) and join the tailnet using
# an auth key resolved via pass-cli/Proton Pass. Idempotent; intended to be
# run via postStartCommand on every container start.
cat > /usr/local/bin/tailscale-up \
<< EOF
#!/usr/bin/env bash
set -euo pipefail

TS_HOSTNAME=\${TS_HOSTNAME:-${HOSTNAME}}
STATE_DIR=/var/lib/tailscale
SOCK=/var/run/tailscale/tailscaled.sock

export PROTON_PASS_KEY_PROVIDER=\${PROTON_PASS_KEY_PROVIDER:-fs}
export PROTON_PASS_AGENT_REASON=\${PROTON_PASS_AGENT_REASON:-"tailscale-up: fetch Tailscale auth key"}

if ! pass-cli info > /dev/null 2>&1; then
  if [ -z "\${PROTON_PASS_PERSONAL_ACCESS_TOKEN:-}" ]; then
    echo "PROTON_PASS_PERSONAL_ACCESS_TOKEN is not set and no pass-cli session exists; cannot join tailnet." >&2
    exit 1
  fi
  pass-cli logout --force
  pass-cli login
fi

if ! pgrep -x tailscaled > /dev/null 2>&1; then
  sudo mkdir -p "\$STATE_DIR" "\$(dirname "\$SOCK")"
  sudo nohup tailscaled --state="\$STATE_DIR/tailscaled.state" --socket="\$SOCK" \\
    > /tmp/tailscaled.log 2>&1 &
  for _ in \$(seq 1 20); do
    [ -S "\$SOCK" ] && break
    sleep 0.5
  done
fi

if sudo tailscale --socket="\$SOCK" status > /dev/null 2>&1; then
  echo "tailscale: already connected"
else
  export SOCK TS_HOSTNAME
  pass-cli run --env-file "/usr/local/etc/tailscale-up.env" -- \\
    sh -c 'exec sudo tailscale --socket="\$SOCK" up --authkey="\$TS_AUTHKEY" --hostname="\$TS_HOSTNAME" --accept-routes --ssh'
  echo "tailscale: joined tailnet as \$TS_HOSTNAME"
fi
EOF

chmod +x /usr/local/bin/tailscale-up

# The auth key's pass-cli path is baked in at install time from this
# feature's `authkeySecretPath` option, same convention as
# devenv-base/.devcontainer/tailscale.env.
mkdir -p /usr/local/etc
printf 'TS_AUTHKEY=pass://%s\n' "${AUTHKEYSECRETPATH}" > /usr/local/etc/tailscale-up.env
