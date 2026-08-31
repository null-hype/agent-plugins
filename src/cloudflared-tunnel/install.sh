#!/bin/sh
set -e

echo "Activating feature 'cloudflared-tunnel'"
echo "The configured hostname is: ${HOSTNAME}"
echo "The configured local port is: ${LOCALPORT}"
echo "The configured tunnel id is: ${TUNNELID}"
echo "The configured token secret path is: ${TOKENSECRETPATH}"

# The 'install.sh' entrypoint script is always executed as the root user.
#
# These following environment variables are passed in by the dev container CLI.
# These may be useful in instances where the context of the final
# remoteUser or containerUser is useful.
# For more details, see https://containers.dev/implementors/features#user-env-var
echo "The effective dev container remoteUser is '$_REMOTE_USER'"
echo "The effective dev container remoteUser's home directory is '$_REMOTE_USER_HOME'"

echo "The effective dev container containerUser is '$_CONTAINER_USER'"
echo "The effective dev container containerUser's home directory is '$_CONTAINER_USER_HOME'"

ARCH="$(dpkg --print-architecture)"
curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}" -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# The env file cloudflared-tunnel's bin passes to `pass-cli run --env-file`,
# resolving CLOUDFLARE_TUNNEL_TOKEN from Pass at runtime rather than baking
# a secret into the image.
mkdir -p /etc/cloudflared-tunnel
cat > /etc/cloudflared-tunnel/cloudflared.env << EOF
CLOUDFLARE_TUNNEL_TOKEN=pass://${TOKENSECRETPATH}
EOF

# Idempotent (pgrep check) and backgrounded (nohup + disown), so the
# connector survives the SSH/exec session that starts it. The tunnel
# itself (ingress config routing ${HOSTNAME} -> http://localhost:${LOCALPORT},
# and the DNS CNAME to ${TUNNELID}.cfargotunnel.com) is assumed already
# provisioned separately (e.g. via the Cloudflare API/dashboard) - this
# bin only gets the local connector running.
cat > /usr/local/bin/start-cloudflared-tunnel << EOF
#!/usr/bin/env bash
# Start cloudflared, tunnelling ${HOSTNAME} to the local service on
# :${LOCALPORT} via Cloudflare Tunnel ${TUNNELID}. Idempotent (process
# check via pgrep) and backgrounded (nohup + disown), so it survives the
# session that invoked it.
set -euo pipefail

export PROTON_PASS_KEY_PROVIDER=\${PROTON_PASS_KEY_PROVIDER:-fs}
export PROTON_PASS_AGENT_REASON="start-cloudflared-tunnel: fetch tunnel token"

ENV_FILE="/etc/cloudflared-tunnel/cloudflared.env"

if pgrep -f "cloudflared tunnel run" > /dev/null 2>&1; then
  echo "cloudflared-tunnel: already running"
else
  pass-cli run --env-file "\$ENV_FILE" -- bash -c '
    set -euo pipefail
    : "\${CLOUDFLARE_TUNNEL_TOKEN:?CLOUDFLARE_TUNNEL_TOKEN not resolved from Pass}"
    nohup cloudflared tunnel run --token "\$CLOUDFLARE_TUNNEL_TOKEN" > /tmp/cloudflared.log 2>&1 &
    disown
  '
  for _ in \$(seq 1 20); do
    pgrep -f "cloudflared tunnel run" > /dev/null 2>&1 && break
    sleep 0.5
  done
  echo "cloudflared-tunnel: started"
fi
EOF
chmod +x /usr/local/bin/start-cloudflared-tunnel
