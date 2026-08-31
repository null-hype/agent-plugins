#!/usr/bin/env bash
# Start the linear-agent webhook server. The server is baked into the
# devenv-linear-agent image (node, /app -- see LinearAgent in main.go) with
# no entrypoint/start command set, so nothing launches it on container
# start -- this is what does. Public reachability at agent.tidelands.dev is
# handled separately by .devcontainer/start-cloudflared.sh (a Cloudflare
# Tunnel connector) -- this script used to also enable `tailscale funnel` on
# $PORT, but that was superseded by the tunnel (see start-cloudflared.sh's
# header for why funnel's cert scoping didn't work under a custom hostname)
# and JIN-41 tracked it as dead code nothing ever disabled; dropped here.
# Idempotent (node process check via pgrep) and backgrounded (nohup +
# disown) so it survives the SSH session that invoked this. /app is baked
# into the image itself (outside the repo checkout devpod mounts as the
# workspace folder), so this cds there directly rather than resolving a
# path relative to this script. DEVENV_BASE_WORKSPACE_DIR captures the
# devpod-mounted checkout's path (this script's own $PWD, before the cd)
# so the server can still hand it to the container-use MCP subprocess in
# claude.ts -- otherwise that subprocess inherits /app's cwd, which has no
# .git (it's a baked directory, not a clone), and container-use refuses to
# do anything at all from there. See JIN-40 agent session for how this was
# diagnosed.
#
# DOCKER_CONFIG is pointed at a plain, credsStore-less config here because
# the devcontainer's docker-outside-of-docker feature writes root's real
# ~/.docker/config.json with "credsStore": "devpod" -- a helper that proxies
# credential lookups to a `devpod agent container credentials-server`
# process spun up fresh per *interactive* `devpod ssh`/`up` connection. This
# server (the persistent node process launched below) outlives any such
# connection, so by the time container-use's Dagger engine asks the helper
# for creds -- even for a fully public image like ubuntu:24.04, which needs
# none -- there's nothing listening and the helper call fails with EOF,
# surfacing as "failed to get credentials: EOF" out of environment_create.
# Confirmed live: reproduced by invoking the helper directly outside an
# active devpod session (immediate EOF) and fixed by pointing DOCKER_CONFIG
# at a config with no credsStore, verified against the real node-process
# environment (JIN-58).
set -euo pipefail

PORT=${PORT:-8080}
export DEVENV_BASE_WORKSPACE_DIR="$PWD"

# JIN-63: a fixed path here (/tmp/linear-agent-docker-config) meant that
# once the directory/file existed with the wrong ownership (e.g. created by
# a root-run SSH session), every later run failed unconditionally at the
# write below -- before even reaching the idempotent pgrep check -- and
# stayed broken forever. A fresh unique dir per run avoids that whole class
# of collision.
DOCKER_CONFIG_DIR="$(mktemp -d /tmp/linear-agent-docker-config.XXXXXX)"
echo '{}' > "$DOCKER_CONFIG_DIR/config.json"
export DOCKER_CONFIG="$DOCKER_CONFIG_DIR"

export PROTON_PASS_KEY_PROVIDER=${PROTON_PASS_KEY_PROVIDER:-fs}
export PROTON_PASS_AGENT_REASON="start-linear-agent: fetch webhook server secrets"

ENV_FILE="$(dirname "${BASH_SOURCE[0]}")/linear-agent.env"

if pgrep -f "node dist/index.js" > /dev/null 2>&1; then
  echo "linear-agent: already running"
else
  pass-cli run --env-file "$ENV_FILE" -- bash -c '
    set -euo pipefail
    cd /app
    nohup node dist/index.js > /tmp/linear-agent.log 2>&1 &
    disown
  '
  for _ in $(seq 1 20); do
    pgrep -f "node dist/index.js" > /dev/null 2>&1 && break
    sleep 0.5
  done
  echo "linear-agent: started"
fi
