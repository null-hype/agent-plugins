# host.sh runs on the toolbox host. The toolbox pipes it over SSH as
# `bash -s -- <action> [args]`, preceded by exports of any secrets the action
# needs. Every action prints one JSON value on stdout.
#
# `up` runs devpod in a detached job so the tool call returns at once (the
# Linear agent gives up on a call after 3 minutes). The job's log, pid and
# exit code stay under ~/.toolbox/jobs, so `status` can report them later.
set -euo pipefail

export REPO=https://github.com/null-hype/agent-plugins.git
# codex_review files findings in team CIT's Triage state.
export LINEAR_TEAM_ID=c59e559d-fd9c-43da-a049-108672cb6bb4
export LINEAR_TRIAGE_STATE_ID=5b35854e-8954-4fec-a99b-61752cd2400c
export LINEAR_API_KEY_REF=pass://api.linear.app/Citizen6.Librarian6.Refrain4/LINEAR_API_KEY
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

# The token stays in the job's environment; git reads it through this
# helper, so it is never written to disk or put in a command line.
git_auth() {
  git config --global credential.https://github.com.helper \
    '!f() { test "$1" = get && echo username=x-access-token && echo "password=$GITHUB_TOKEN"; }; f'
}

run_up() {
  set -euo pipefail
  local id=$1 ref=$2 agent=$3 s
  git_auth
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

# Reviews the PR with the host's Codex login, so AGENTS.md sets the criteria,
# and has Codex create a container-use environment and a Linear triage issue
# for each finding. Its final message, one line per finding, lands in $out.
# Each environment's branch is then pushed under its issue's branch name, so
# Linear links it to the issue, and the pre-push hook's backup runs.
run_review() {
  set -euo pipefail
  local pr=$1 model=$2 out=$3 dir=$HOME/.toolbox/reviews/$1 env=$HOME/.toolbox/linear.env hk
  git_auth
  # Codex never sees the Linear key: its curl runs under `pass-cli run`,
  # which resolves this reference. Same login as tailscale-up.sh.
  export PROTON_PASS_KEY_PROVIDER=fs
  if ! pass-cli info >/dev/null 2>&1; then
    pass-cli logout --force >/dev/null 2>&1 || true
    pass-cli login
  fi
  echo "LINEAR_API_KEY=$LINEAR_API_KEY_REF" > "$env"
  # container-use commits each environment, so git needs an author.
  git config --global user.name toolbox
  git config --global user.email toolbox@toolbox-host
  [ -d "$dir" ] || git clone -q "$REPO" "$dir"
  cd "$dir"
  git fetch -q origin +main:refs/remotes/origin/main "+pull/$pr/head:refs/pr/$pr"
  git checkout -q -B "pr-$pr" "refs/pr/$pr"
  # workspace-write lets the AGENTS.md QA pass run commands in the checkout.
  # Network access is for Linear's API, and pass-cli writes its session.
  # exec runs with approval policy never, so the MCP tools are pre-approved.
  codex exec -c 'sandbox_mode="workspace-write"' ${model:+-m "$model"} \
    -c 'sandbox_workspace_write.network_access=true' \
    -c "sandbox_workspace_write.writable_roots=[\"$HOME/.local/share/proton-pass-cli\"]" \
    -c 'mcp_servers.container-use.command="/usr/local/bin/container-use"' \
    -c 'mcp_servers.container-use.args=["stdio"]' \
    -c 'mcp_servers.container-use.default_tools_approval_mode="approve"' \
    -o "$out" - <<PROMPT
Review this branch against origin/main using the review guidelines in AGENTS.md.
For each finding, call the container-use environment_create tool (environment_source: this repository's
directory), titled with the finding, with the finding's explanation. Then file the finding in Linear with
an issueCreate mutation: teamId $LINEAR_TEAM_ID, stateId $LINEAR_TRIAGE_STATE_ID, the finding as the title,
and a description with its explanation, the PR (https://github.com/null-hype/agent-plugins/pull/$pr) and
the environment id. Ask for the created issue's identifier and branchName, then attach
https://github.com/null-hype/agent-plugins/tree/<branchName> to the issue with attachmentLinkURL, titled
"Finding environment branch"; the environment is pushed there after you finish. Send each GraphQL request body on stdin to:
PROTON_PASS_KEY_PROVIDER=fs pass-cli run --env-file $env -- sh -c 'curl -fsS https://api.linear.app/graphql -H "Content-Type: application/json" -H "Authorization: \$LINEAR_API_KEY" --data @-'
Then print one line per finding: environment id, Linear issue identifier, Linear branchName, title.
PROMPT
  grep -E '^[a-z]+-[a-z]+, [A-Z]+-[0-9]+, [^ ,]+, ' "$out" | while IFS=', ' read -r env issue branch _; do
    git fetch -q container-use "$env"
    git push -q origin "FETCH_HEAD:refs/heads/$branch"
    echo "== pushed $env as $branch ($issue)"
  done
  # The clone has no hk hooks, so run the pre-push backup here: it snapshots
  # container-use and Codex state to restic. It comes from main, not the PR
  # under review, since it runs with the restic credentials.
  hk=$(mktemp -d)
  git archive origin/main .dagger/internal/devenv-base/hk .dagger/internal/devenv-base/.devcontainer | tar -x -C "$hk"
  bash "$hk/.dagger/internal/devenv-base/hk/claude-session-backup.sh"
  rm -rf "$hk"
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
  setsid nohup bash -c "$(declare -f git_auth run_up)"'
    (run_up "$@"); echo $? > "'"$JOBS/$id.exit"'"' _ "$id" "$ref" "$agent" \
    > "$JOBS/$id.log" 2>&1 < /dev/null &
  echo $! > "$JOBS/$id.pid"
  workspace_json "$id"
  ;;
review)
  pr=$1 model=${2:-} id=review-$1
  refuse_if_busy "$id"
  rm -f "$JOBS/$id.exit" "$JOBS/$id.md"
  setsid nohup bash -c "$(declare -f git_auth run_review)"'
    (run_review "$@"); echo $? > "'"$JOBS/$id.exit"'"' _ "$pr" "$model" "$JOBS/$id.md" \
    > "$JOBS/$id.log" 2>&1 < /dev/null &
  echo $! > "$JOBS/$id.pid"
  jq -n --argjson pr "$pr" '{pr: $pr, job_running: true}'
  ;;
review-status)
  id=review-$1
  jq -n --argjson job_running "$(job_running "$id" && echo true || echo false)" \
    --argjson job_exit "$(cat "$JOBS/$id.exit" 2>/dev/null || echo null)" \
    --arg findings "$(cat "$JOBS/$id.md" 2>/dev/null || true)" \
    --arg log_tail "$(tail -n 40 "$JOBS/$id.log" 2>/dev/null || true)" \
    '{job_running: $job_running, job_exit: $job_exit, findings: $findings, log_tail: $log_tail}'
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
