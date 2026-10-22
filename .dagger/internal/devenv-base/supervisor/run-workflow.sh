#!/usr/bin/env bash
# The hourly tick of the supervisor Workflow (CIT-472): runs its `run` task
# for real, which executes every ready cluster of the committed changeset
# with its hat, model and effort, and prints each cluster's SUPERVISOR_PASS
# line. Fails if the run fails or any cluster errors, so a quiet failure
# shows as a red scheduled run.
#
# Needs RENDER_API_KEY, resolved from Proton Pass by the caller. TEAM and
# RUN_TASK default to the supervisor's.
set -euo pipefail
: "${RENDER_API_KEY:?}"
RUN_TASK=${RUN_TASK:-supervisor-workflow/run}
TEAM=${TEAM:-CIT}
api() { curl -sS --fail-with-body -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" "$@"; }

run=$(jq -n --arg t "$RUN_TASK" --arg team "$TEAM" '{task: $t, input: [false, $team]}' |
  api -X POST https://api.render.com/v1/task-runs --data @- | jq -r .id)
echo "run-workflow: task run $run"
# A cluster may take its whole hour; the parent is paused while they run.
for _ in $(seq 1 "${RUN_WAIT:-400}"); do
  body=$(api "https://api.render.com/v1/task-runs/$run")
  case $(jq -r .status <<< "$body") in pending | running | paused) sleep 10 ;; *) break ;; esac
done
jq -r '"status: \(.status)", (.attempts[-1].error // "" | select(. != "") | "error: \(.)"),
  (.results[0][]? | if .error then "ERROR \(.cluster): \(.error)" else .pass end)' <<< "$body"
jq -e '.status == "completed" and ([.results[0][]? | select(.error)] | length) == 0' <<< "$body" > /dev/null ||
  { echo "run-workflow: the run did not complete cleanly" >&2; exit 1; }
jq -r '"SUPERVISOR_RAN: clusters=\(.results[0] | length)"' <<< "$body"
