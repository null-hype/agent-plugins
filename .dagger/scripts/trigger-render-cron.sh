#!/usr/bin/env bash
# Kicks a run of a Render Cron Job via Render's "Trigger cron job run" API
# (https://api-docs.render.com/reference/run-cron-job:
# POST /cron-jobs/{cronJobId}/runs), instead of waiting for its schedule --
# e.g. right after publishing a new image so the box picks up new
# image/state without waiting for the next scheduled run.
#
# RENDER_API_KEY and RENDER_CRON_JOB_ID are passed in as plain env vars by
# the caller (the TriggerRenderCron Dagger function) -- this script itself
# has no opinion on where they come from, so it stays reusable across any
# Render Cron Job rather than hardcoded to one project's secret store.
set -euo pipefail

: "${RENDER_API_KEY:?RENDER_API_KEY must be set}"
: "${RENDER_CRON_JOB_ID:?RENDER_CRON_JOB_ID must be set}"

OUT_FILE=$(mktemp)
trap 'rm -f "$OUT_FILE"' EXIT

STATUS=$(curl -s -o "$OUT_FILE" -w "%{http_code}" \
  --max-time 15 \
  -X POST "https://api.render.com/v1/cron-jobs/$RENDER_CRON_JOB_ID/runs" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Accept: application/json")

echo "trigger-render-cron: HTTP $STATUS"
cat "$OUT_FILE"
echo

if [ "$STATUS" -ge 200 ] && [ "$STATUS" -lt 300 ]; then
  echo "RENDER_CRON_TRIGGER: OK"
else
  echo "RENDER_CRON_TRIGGER: FAIL" >&2
  echo "expected 2xx, got $STATUS -- check RENDER_API_KEY/RENDER_CRON_JOB_ID, or that the cron job id is still valid." >&2
  exit 1
fi
