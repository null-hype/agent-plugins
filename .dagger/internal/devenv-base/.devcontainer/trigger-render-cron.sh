#!/usr/bin/env bash
# Manually kicks a run of the devpod-keepalive Render Cron Job (render.yaml)
# via Render's "Trigger cron job run" API
# (https://api-docs.render.com/reference/run-cron-job:
# POST /cron-jobs/{cronJobId}/runs), instead of waiting for its hourly
# schedule -- e.g. right after PublishLinearAgent/RecreateDevpod so the box
# picks up a new image/state without waiting up to an hour.
#
# RENDER_API_KEY/RENDER_SERVICE_ID are resolved from Proton Pass via
# render.env, same pass:// indirection gcloud.env/linear-agent.env already
# use, so neither value has to be stored as a plain GitHub Actions secret.
set -euo pipefail

ENV_FILE="$(dirname "${BASH_SOURCE[0]}")/render.env"

export PROTON_PASS_KEY_PROVIDER=${PROTON_PASS_KEY_PROVIDER:-fs}
export PROTON_PASS_AGENT_REASON="trigger-render-cron: fetch Render API key to trigger devpod-keepalive run"

pass-cli run --env-file "$ENV_FILE" -- bash -c '
  set -euo pipefail
  : "${RENDER_API_KEY:?RENDER_API_KEY not resolved from Pass}"
  : "${RENDER_SERVICE_ID:?RENDER_SERVICE_ID not resolved from Pass}"

  STATUS=$(curl -s -o /tmp/trigger-render-cron.out -w "%{http_code}" \
    --max-time 15 \
    -X POST "https://api.render.com/v1/cron-jobs/$RENDER_SERVICE_ID/runs" \
    -H "Authorization: Bearer $RENDER_API_KEY" \
    -H "Accept: application/json")

  echo "trigger-render-cron: HTTP $STATUS"
  cat /tmp/trigger-render-cron.out
  echo

  if [ "$STATUS" -ge 200 ] && [ "$STATUS" -lt 300 ]; then
    echo "RENDER_CRON_TRIGGER: OK"
  else
    echo "RENDER_CRON_TRIGGER: FAIL" >&2
    echo "expected 2xx, got $STATUS -- check RENDER_API_KEY/RENDER_SERVICE_ID in Pass, or that the cron job id is still valid." >&2
    exit 1
  fi
'
