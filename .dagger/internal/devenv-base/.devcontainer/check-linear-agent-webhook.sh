#!/usr/bin/env bash
# Smoke-tests whether the LINEAR_WEBHOOK_SECRET currently in Proton Pass
# actually matches the secret the running linear-agent process loaded at
# startup. Run this on the box itself (e.g. `devpod ssh <id> --command
# "bash .devcontainer/check-linear-agent-webhook.sh"`) rather than over the
# network: it hits localhost, so the only variable under test is "does
# Pass's current secret match what the running process has," not tailscale
# reachability or TLS/proxying in front of it.
#
# Builds a minimal AgentSessionEvent payload -- action "created" with no
# promptContext, same shape webhook.test.ts uses, which server.ts's handler
# short-circuits on before touching the Linear API or `claude` -- signs it
# with the real secret, and POSTs it to the live server. 200 means the
# secrets match end-to-end; 400 means Pass's current secret and the
# process's loaded secret have drifted (e.g. rotated in Pass without
# restarting the process, or a stale value in linear-agent.env).
set -euo pipefail

PORT=${PORT:-8080}
ENV_FILE="$(dirname "${BASH_SOURCE[0]}")/linear-agent.env"

export PROTON_PASS_KEY_PROVIDER=${PROTON_PASS_KEY_PROVIDER:-fs}
export PROTON_PASS_AGENT_REASON="check-linear-agent-webhook: fetch webhook secret to smoke-test"
export PORT

pass-cli run --env-file "$ENV_FILE" -- bash -c '
  set -euo pipefail
  : "${LINEAR_WEBHOOK_SECRET:?LINEAR_WEBHOOK_SECRET not resolved from Pass}"

  BODY=$(node -e "
    console.log(JSON.stringify({
      type: \"AgentSessionEvent\",
      action: \"created\",
      appUserId: \"smoke-test\",
      oauthClientId: \"smoke-test\",
      organizationId: \"smoke-test\",
      webhookId: \"smoke-test\",
      webhookTimestamp: Date.now(),
      createdAt: new Date().toISOString(),
      agentSession: {
        id: \"smoke-test\",
        appUserId: \"smoke-test\",
        organizationId: \"smoke-test\",
        status: \"pending\",
        type: \"commentThread\",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }));
  ")

  SIGNATURE=$(node -e "
    const crypto = require(\"crypto\");
    process.stdout.write(crypto.createHmac(\"sha256\", process.env.LINEAR_WEBHOOK_SECRET).update(process.argv[1]).digest(\"hex\"));
  " "$BODY")

  STATUS=$(curl -s -o /tmp/check-linear-agent-webhook.out -w "%{http_code}" \
    -X POST "http://127.0.0.1:$PORT/webhooks/linear" \
    -H "Content-Type: application/json" \
    -H "linear-signature: $SIGNATURE" \
    --data-binary "$BODY")

  echo "linear-agent webhook smoke test: HTTP $STATUS"
  cat /tmp/check-linear-agent-webhook.out
  echo

  if [ "$STATUS" = "200" ]; then
    echo "OK: Pass secret and running process secret agree."
  else
    echo "MISMATCH (or server issue): expected 200, got $STATUS." >&2
    echo "If the server was started before a Pass secret rotation, restart it: bash .devcontainer/start-linear-agent.sh (after stopping the old process)." >&2
    exit 1
  fi
'
