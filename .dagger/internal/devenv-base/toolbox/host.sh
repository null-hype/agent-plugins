# host.sh runs on the toolbox host. The toolbox pipes it over SSH as
# `bash -s -- <action> [args]`, preceded by exports of any secrets the action
# needs. Every action prints one JSON value on stdout.
#
# `up` runs devpod in a detached job so the tool call returns at once (the
# Linear agent gives up on a call after 3 minutes). The job's log, pid and
# exit code stay under ~/.toolbox/jobs, so `status` can report them later.
set -euo pipefail

export REPO=https://github.com/null-hype/agent-plugins.git
export DEVCONTAINER_DIR=.dagger/internal/devenv-base/.devcontainer
# Same order as keepalive/runner/bootstrap.go.
export AGENT_SCRIPTS="generate-env-files.sh tailscale-up.sh install-tools.sh start-linear-agent.sh start-cloudflared.sh check-linear-agent-webhook-live.sh"
JOBS=$HOME/.toolbox/jobs
mkdir -p "$JOBS"

job_running() {
  [ -f "$JOBS/$1.pid" ] && kill -0 "$(cat "$JOBS/$1.pid")" 2>/dev/null
}

state() {
  local s
  s=$(devpod status "$1" --output json 2>/dev/null | jq -r '.state // empty') || true
  echo "${s:-NotFound}"
}

workspace_json() {
  jq -n --arg name "$1" --arg state "$(state "$1")" \
    --argjson job_running "$(job_running "$1" && echo true || echo false)" \
    '{name: $name, state: $state, job_running: $job_running}'
}

refuse_if_busy() {
  if job_running "$1"; then
    echo "a job for $1 is still running; check workspace_status" >&2
    exit 1
  fi
}

run_up() {
  set -euo pipefail
  local id=$1 ref=$2 agent=$3 s
  # The token stays in the job's environment; git reads it through this
  # helper, so it is never written to disk or put in a command line.
  git config --global credential.https://github.com.helper \
    '!f() { test "$1" = get && echo username=x-access-token && echo "password=$GITHUB_TOKEN"; }; f'
  if [ "$(devpod status "$id" --output json 2>/dev/null | jq -r '.state // empty')" = "" ]; then
    devpod up "$id" --id "$id" --source "git:$REPO@$ref" --provider docker --ide none \
      --devcontainer-path .devcontainer/devcontainer.json
  else
    echo "== $id exists; starting it (ref $ref is only used on creation)"
    devpod up "$id" --ide none
  fi
  [ "$agent" = 1 ] || return 0
  for s in $AGENT_SCRIPTS; do
    echo "== $s"
    if [ "$s" = tailscale-up.sh ]; then
      devpod ssh "$id" --send-env PROTON_PASS_PERSONAL_ACCESS_TOKEN \
        --command "bash /workspaces/$id/$DEVCONTAINER_DIR/$s"
    else
      devpod ssh "$id" --command "bash /workspaces/$id/$DEVCONTAINER_DIR/$s"
    fi
  done
}

action=${1:?action}
shift
case $action in
ping)
  # Written last by host-startup.sh on every boot.
  test -f "${TOOLBOX_READY_FILE:-/var/lib/toolbox-host.ready}"
  devpod version >/dev/null
  docker info >/dev/null
  # Join the tailnet once, with Tailscale SSH; tailscaled keeps the node
  # across reboots. The auth key reaches tailscale up as a 0600 file, not
  # an argument.
  if [ "$(tailscale status --json 2>/dev/null | jq -r '.BackendState // empty')" != Running ] &&
    [ -n "${TS_AUTHKEY:-}" ]; then
    key=$(mktemp)
    printf %s "$TS_AUTHKEY" > "$key"
    sudo tailscale up --auth-key="file:$key" --hostname=toolbox-host --ssh >&2 || true
    rm -f "$key"
  fi
  tailscale status --json 2>/dev/null |
    jq '{ready: true, tailnet: {state: .BackendState, name: (.Self.DNSName // "" | rtrimstr(".")), ips: (.Self.TailscaleIPs // []), online: (.Self.Online // false)}}' ||
    echo '{"ready": true, "tailnet": {"state": "NotInstalled"}}'
  ;;
list)
  devpod list --output json | jq -r '.[]?.id' | while read -r id; do
    workspace_json "$id"
  done | jq -s .
  ;;
status)
  id=$1
  jq -n --argjson ws "$(workspace_json "$id")" \
    --argjson job_exit "$(cat "$JOBS/$id.exit" 2>/dev/null || echo null)" \
    --arg log_tail "$(tail -n 40 "$JOBS/$id.log" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' || true)" \
    '$ws + {job_exit: $job_exit, log_tail: $log_tail}'
  ;;
up)
  id=$1 ref=$2 agent=$3
  refuse_if_busy "$id"
  rm -f "$JOBS/$id.exit"
  setsid nohup bash -c "$(declare -f run_up)"'
    (run_up "$@"); echo $? > "'"$JOBS/$id.exit"'"' _ "$id" "$ref" "$agent" \
    > "$JOBS/$id.log" 2>&1 < /dev/null &
  echo $! > "$JOBS/$id.pid"
  workspace_json "$id"
  ;;
stop)
  refuse_if_busy "$1"
  devpod stop "$1" >&2
  workspace_json "$1"
  ;;
delete)
  refuse_if_busy "$1"
  devpod delete "$1" --force >&2
  rm -f "$JOBS/$1".*
  workspace_json "$1"
  ;;
*)
  echo "unknown action $action" >&2
  exit 2
  ;;
esac
