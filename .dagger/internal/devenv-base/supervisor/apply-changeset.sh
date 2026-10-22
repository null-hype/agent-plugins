#!/usr/bin/env bash
# Merging is applying (CIT-472), from the supervisor's own run on Render:
#
#   apply-changeset.sh start COMMIT   waits for Render to deploy COMMIT as a
#       version of the supervisor Workflow, starts its `apply` task with
#       dryRun false, and prints the task run's id. It does not wait for the
#       apply: one that delegates or ships wakes the host first, which alone
#       may take 15 minutes.
#   apply-changeset.sh status RUN     prints that run's status, what it
#       applied and what it skipped. Exits 1 if it failed or is gone, so the
#       next run can start it again; 0 while it runs or once it completed.
#
# Needs RENDER_API_KEY. WORKFLOW_ID and APPLY_TASK default to the
# supervisor's.
set -euo pipefail
: "${RENDER_API_KEY:?}"
WORKFLOW_ID=${WORKFLOW_ID:-wfl-dbche33rjlhs73bgkrr0}
APPLY_TASK=${APPLY_TASK:-supervisor-workflow/apply}
TEAM=${TEAM:-CIT}
api() { curl -sS --fail-with-body -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" "$@"; }

case "${1:-}" in
  start)
    commit=${2:?usage: apply-changeset.sh start COMMIT}
    # Render names each version after the short commit it built.
    short=${commit:0:7}
    status=""
    for _ in $(seq 1 "${DEPLOY_WAIT:-180}"); do
      status=$(api "https://api.render.com/v1/workflowversions?workflowId=$WORKFLOW_ID&limit=20" |
        jq -r --arg n "$short" '[.[].workflowVersion | select(.name == $n)][0].status // "missing"')
      case $status in
        ready) break ;;
        *fail* | canceled) echo "apply-changeset: version $short ended $status" >&2; exit 1 ;;
      esac
      sleep "${DEPLOY_POLL:-5}"
    done
    [ "$status" = ready ] || { echo "apply-changeset: version $short never became ready (last: $status)" >&2; exit 1; }
    jq -n --arg t "$APPLY_TASK" --arg team "$TEAM" '{task: $t, input: [false, $team]}' |
      api -X POST https://api.render.com/v1/task-runs --data @- | jq -er .id
    ;;
  status)
    run=${2:?usage: apply-changeset.sh status RUN}
    body=$(api "https://api.render.com/v1/task-runs/$run") || { echo "apply-changeset: no task run $run" >&2; exit 1; }
    jq -r '"status: \(.status)", (.attempts[-1].error // "" | select(. != "") | "error: \(.)"),
      (.results[0].applied[]? | "applied \(.op) \(.target): \(.detail)"),
      (.results[0].skipped[]? | "skipped \(.op) \(.target): \(.why)")' <<< "$body"
    case $(jq -r .status <<< "$body") in pending | running | completed) ;; *) exit 1 ;; esac
    ;;
  *) echo "usage: apply-changeset.sh start COMMIT | status RUN" >&2; exit 2 ;;
esac
