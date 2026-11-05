#!/usr/bin/env bash
# Start the second Linear agent: the same linear-agent server baked into
# /app (see start-linear-agent.sh), run with AGENT_RUNTIME=openrouter from
# openrouter-agent.env -- its own Linear OAuth app, an open-weight model on
# OpenRouter instead of Claude, port 8081 instead of 8080, and its own
# claims directory. Public reachability is the same Cloudflare tunnel as
# the Claude agent's, with a second hostname
# (openrouter-agent.tidelands.dev -> http://localhost:8081) in the tunnel's
# ingress, and Linear's webhooks reach it through the toolbox's
# /linear/agent-webhook/openrouter relay (toolbox/README.md).
#
# Optional by design: it runs in AGENT_SCRIPTS after the Claude agent's start,
# and a host without this agent set up must still bring the Claude agent up.
# So it exits 0, saying why, when the image predates the openrouter runtime
# or the Pass item behind openrouter-agent.env does not resolve yet. A
# delegation to this agent then fails visibly at the relay (a comment on the
# issue), not here.
#
# The process is `node /app/dist/index.js`, which start-linear-agent.sh's
# `pgrep -f "node dist/index.js"` does not match and which does not match
# that one, so each script sees only its own agent. Idempotent and
# backgrounded like start-linear-agent.sh.
set -euo pipefail

PORT=8081
export DEVENV_BASE_WORKSPACE_DIR="$PWD"
export LINEAR_AGENT_STATE_DIR="${HOME}/.linear-agent/openrouter-claims"

# See start-linear-agent.sh (JIN-58, JIN-63).
DOCKER_CONFIG_DIR="$(mktemp -d /tmp/openrouter-agent-docker-config.XXXXXX)"
echo '{}' > "$DOCKER_CONFIG_DIR/config.json"
export DOCKER_CONFIG="$DOCKER_CONFIG_DIR"

export PROTON_PASS_KEY_PROVIDER=${PROTON_PASS_KEY_PROVIDER:-fs}
export PROTON_PASS_AGENT_REASON="start-openrouter-agent: fetch webhook server secrets"

ENV_FILE="$(dirname "${BASH_SOURCE[0]}")/openrouter-agent.env"

if [ ! -f /app/dist/openrouter.js ]; then
  echo "openrouter-agent: skipped; this image's /app has no openrouter runtime (publish the linear-agent image first)"
  exit 0
fi

if pgrep -f "node /app/dist/index.js" > /dev/null 2>&1; then
  echo "openrouter-agent: already running"
  exit 0
fi

. "$(dirname "${BASH_SOURCE[0]}")/lib/pass-env.sh"
if ! RESOLVED=$(pass_env "$ENV_FILE"); then
  echo "openrouter-agent: skipped; $ENV_FILE does not resolve from Pass (is pass://tidelands.dev/openrouter-agent set up?)"
  exit 0
fi
trap 'rm -f "$RESOLVED"' EXIT
ENV_FILE=$RESOLVED
if ! pass-cli run --env-file "$ENV_FILE" -- true > /dev/null 2>&1; then
  echo "openrouter-agent: skipped; $ENV_FILE does not resolve from Pass (is pass://tidelands.dev/openrouter-agent set up?)"
  exit 0
fi

pass-cli run --env-file "$ENV_FILE" -- bash -c '
  set -euo pipefail
  cd /app
  nohup node /app/dist/index.js > /tmp/openrouter-agent.log 2>&1 &
  disown
'
# /healthz answers 200 once the install token is loaded and 503 before the
# OAuth install; either way the server is up.
for _ in $(seq 1 20); do
  case "$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/healthz" 2>/dev/null)" in
  200 | 503)
    echo "openrouter-agent: started"
    exit 0
    ;;
  esac
  sleep 0.5
done
echo "openrouter-agent: did not answer on :$PORT; see /tmp/openrouter-agent.log" >&2
tail -n 20 /tmp/openrouter-agent.log >&2 || true
exit 0
