#!/usr/bin/env bash
# Merging is applying (CIT-472). Run after a merge to main that changed
# workflow/changeset.json: waits for Render to deploy that commit as a new
# version of the supervisor Workflow, then runs its `apply` task with
# dryRun false and prints what it did. Fails if the version does not build,
# the task fails, or any op was skipped (drift since planning).
#
# Needs RENDER_API_KEY, resolved from Proton Pass by the caller, and
# COMMIT, the merged commit. WORKFLOW_ID and APPLY_TASK default to the
# supervisor's.
set -euo pipefail
: "${RENDER_API_KEY:?}" "${COMMIT:?}"
WORKFLOW_ID=${WORKFLOW_ID:-wfl-dbche33rjlhs73bgkrr0}
APPLY_TASK=${APPLY_TASK:-supervisor-workflow/apply}
TEAM=${TEAM:-CIT}
api() { curl -sS --fail-with-body -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" "$@"; }

# Render names each version after the short commit it built.
short=${COMMIT:0:7}
status=""
for _ in $(seq 1 "${DEPLOY_WAIT:-180}"); do
  status=$(api "https://api.render.com/v1/workflowversions?workflowId=$WORKFLOW_ID&limit=20" |
    jq -r --arg n "$short" '[.[].workflowVersion | select(.name == $n)][0].status // "missing"')
  case $status in
    ready) break ;;
    *fail* | canceled) echo "apply-changeset: version $short ended $status" >&2; exit 1 ;;
  esac
  sleep 5
done
[ "$status" = ready ] || { echo "apply-changeset: version $short never became ready (last: $status)" >&2; exit 1; }
echo "apply-changeset: version $short is ready"

run=$(jq -n --arg t "$APPLY_TASK" --arg team "$TEAM" '{task: $t, input: [false, $team]}' |
  api -X POST https://api.render.com/v1/task-runs --data @- | jq -r .id)
echo "apply-changeset: task run $run"
for _ in $(seq 1 "${RUN_WAIT:-200}"); do
  body=$(api "https://api.render.com/v1/task-runs/$run")
  case $(jq -r .status <<< "$body") in pending | running) sleep 3 ;; *) break ;; esac
done
jq -r '"status: \(.status)", (.attempts[-1].error // "" | select(. != "") | "error: \(.)"),
  (.results[0].applied[]? | "applied \(.op) \(.target): \(.detail)"),
  (.results[0].skipped[]? | "SKIPPED \(.op) \(.target): \(.why)")' <<< "$body"
jq -e '.status == "completed" and .results[0].dryRun == false and (.results[0].skipped | length) == 0' <<< "$body" > /dev/null ||
  { echo "apply-changeset: the changeset did not apply cleanly" >&2; exit 1; }
jq -r '"SUPERVISOR_APPLIED: ops=\(.results[0].applied | length)"' <<< "$body"
