#!/usr/bin/env bash
# Merging is applying (CIT-472). The supervisor's hourly run, on Render,
# applies the changeset that merged since the last one:
#
#   apply-changeset.sh start COMMIT   waits for Render to deploy COMMIT as a
#       version of the supervisor Workflow, starts its `apply` task with
#       dryRun false, and prints the task run's id. It does not wait for the
#       apply: one that delegates or ships wakes the host first, which alone
#       may take 15 minutes.
#   apply-changeset.sh status RUN     prints that run's status, what it
#       applied, skipped and left pending. Exits 1 if it failed or is gone,
#       so the next run can start it again; 3 if it completed with ops still
#       pending (a ship deferred behind another, CIT-523), which the next run
#       applies again too; 0 while it runs or once it completed in full.
#   apply-changeset.sh wait RUN       status, once the run has ended or
#       RUN_WAIT polls (3s apart, 10 minutes by default) have passed.
#
# Needs RENDER_API_KEY. WORKFLOW_ID and APPLY_TASK default to the
# supervisor's.
set -euo pipefail
: "${RENDER_API_KEY:?}"
WORKFLOW_ID=${WORKFLOW_ID:-wfl-dbche33rjlhs73bgkrr0}
APPLY_TASK=${APPLY_TASK:-supervisor-workflow/apply}
TEAM=${TEAM:-CIT}
api() { curl -sS --fail-with-body -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" "$@"; }
status() { # $1: the task run
  local body
  body=$(api "https://api.render.com/v1/task-runs/$1") || { echo "apply-changeset: no task run $1" >&2; return 1; }
  jq -r '"status: \(.status)", (.attempts[-1].error // "" | select(. != "") | "error: \(.)"),
    (.results[0] // empty | "outcome: \(.applied | length) applied, \(.skipped | length) skipped, \(.pending // [] | length) pending"),
    (.results[0].applied[]? | "applied \(.op) \(.target): \(.detail)"),
    (.results[0].skipped[]? | "skipped \(.op) \(.target): \(.why)"),
    (.results[0].pending[]? | "pending (\(.state)) \(.op) \(.target): \(.why)"),
    (.results[0].failed[]? | "failed \(.op) \(.target): \(.why)")' <<< "$body"
  case $(jq -r .status <<< "$body") in
    pending | running) ;;
    completed) [ "$(jq '.results[0].pending // [] | length' <<< "$body")" = 0 ] || return 3 ;;
    *) return 1 ;;
  esac
}

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
  wait)
    run=${2:?usage: apply-changeset.sh wait RUN}
    for _ in $(seq 1 "${RUN_WAIT:-200}"); do
      case $(api "https://api.render.com/v1/task-runs/$run" | jq -r .status) in pending | running) sleep 3 ;; *) break ;; esac
    done
    status "$run"
    ;;
  status) status "${2:?usage: apply-changeset.sh status RUN}" ;;
  *) echo "usage: apply-changeset.sh start COMMIT | status RUN | wait RUN" >&2; exit 2 ;;
esac
