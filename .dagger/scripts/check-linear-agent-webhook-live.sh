#!/usr/bin/env bash
# Live counterpart to check-linear-agent-webhook.sh: instead of hitting
# localhost (secret agreement only), this signs the same minimal
# AgentSessionEvent payload webhook.test.ts and check-linear-agent-webhook.sh
# use and POSTs it to the real public URL, https://agent.tidelands.dev. A 200
# here confirms the whole path Linear's own webhooks actually take: DNS,
# TLS, the tailscale funnel, the running node process, and that the
# LINEAR_WEBHOOK_SECRET in Pass matches what the process loaded -- all in one
# shot, from wherever this runs (the box itself, this devpod, anywhere with
# pass-cli and network access -- unlike check-linear-agent-webhook.sh it does
# NOT need to run on the box).
#
# Uses openssl for the HMAC instead of node so this has no node dependency of
# its own (the keepalive image doesn't carry node).
#
# On success prints the literal marker line "LIVE_WEBHOOK_CHECK: OK", which
# keepalive/devpod-keepalive.sh greps for to decide whether the cron run
# actually succeeded, since a truncated devpod ssh session can otherwise look
# identical to a real success.
set -euo pipefail

URL=${URL:-https://agent.tidelands.dev/webhooks/linear}
ENV_FILE="$(dirname "${BASH_SOURCE[0]}")/linear-agent.env"

export PROTON_PASS_KEY_PROVIDER=${PROTON_PASS_KEY_PROVIDER:-fs}
export PROTON_PASS_AGENT_REASON="check-linear-agent-webhook-live: fetch webhook secret to smoke-test live endpoint"
export URL

pass-cli run --env-file "$ENV_FILE" -- bash -c '
  set -euo pipefail
  : "${LINEAR_WEBHOOK_SECRET:?LINEAR_WEBHOOK_SECRET not resolved from Pass}"

  NOW_MS=$(($(date +%s%N) / 1000000))
  NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  BODY=$(cat <<EOF
{"type":"AgentSessionEvent","action":"created","appUserId":"smoke-test","oauthClientId":"smoke-test","organizationId":"smoke-test","webhookId":"smoke-test","webhookTimestamp":$NOW_MS,"createdAt":"$NOW_ISO","agentSession":{"id":"smoke-test","appUserId":"smoke-test","organizationId":"smoke-test","status":"pending","type":"commentThread","createdAt":"$NOW_ISO","updatedAt":"$NOW_ISO"}}
EOF
  )

  SIGNATURE=$(printf "%s" "$BODY" | openssl dgst -sha256 -hmac "$LINEAR_WEBHOOK_SECRET" | sed "s/^.* //")

  STATUS=$(curl -s -o /tmp/check-linear-agent-webhook-live.out -w "%{http_code}" \
    --max-time 15 \
    -X POST "$URL" \
    -H "Content-Type: application/json" \
    -H "linear-signature: $SIGNATURE" \
    --data-binary "$BODY")

  echo "linear-agent live webhook smoke test: HTTP $STATUS ($URL)"
  cat /tmp/check-linear-agent-webhook-live.out
  echo

  if [ "$STATUS" = "200" ]; then
    echo "LIVE_WEBHOOK_CHECK: OK"
  else
    echo "LIVE_WEBHOOK_CHECK: FAIL" >&2
    echo "expected 200, got $STATUS -- check DNS/tailscale funnel/process health, or a Pass secret rotated without a process restart." >&2
    exit 1
  fi
'
