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
# agent_ship's push token: can push this repository and nothing else.
export SHIP_PUSH_PAT_REF=pass://infra/github.com/GITHUB_TOKEN
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

# GitHub's REST API; the token reaches curl as a header file, not an argument.
api() {
  curl -fsS -H @<(printf 'Authorization: Bearer %s' "$GITHUB_TOKEN") -H 'Accept: application/vnd.github+json' "$@"
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
  # The scripts run from the workspace's checkout, and so does every
  # container-use environment the agent creates. The agent server moves it
  # to origin/main before each turn; start the scripts from there too, not
  # from the ref the workspace was created with.
  devpod ssh "$id" --command "cd /workspaces/$id && git fetch -q origin && git checkout -q --detach origin/main" </dev/null ||
    echo "== could not move $id to origin/main; running the scripts it has" >&2
  for s in $AGENT_SCRIPTS; do
    echo "== $s"
    if [ "$s" = tailscale-up.sh ]; then
      devpod ssh "$id" --send-env PROTON_PASS_PERSONAL_ACCESS_TOKEN \
        --command "bash /workspaces/$id/$DEVCONTAINER_DIR/$s"
      # MagicDNS points the container's resolv.conf at 100.100.100.100, and
      # then public names stop resolving, so the next script's pass-cli
      # cannot reach Proton. Turned off here as well as in tailscale-up.sh,
      # in case the checkout could not be moved to origin/main above.
      devpod ssh "$id" --command 's=; [ "$(id -u)" = 0 ] || s=sudo
        $s tailscale --socket=/var/run/tailscale/tailscaled.sock set --accept-dns=false
        getent ahosts pass.proton.me >/dev/null || { echo "public names do not resolve in the container" >&2; exit 1; }'
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
  local pr=$1 model=$2 out=$3 dir=$HOME/.toolbox/reviews/$1 env=$HOME/.toolbox/linear.env hk base
  git_auth
  # Against the PR's own base: a stacked PR reviewed against main would also
  # get findings for the code it sits on.
  base=$(api "https://api.github.com/repos/null-hype/agent-plugins/pulls/$pr" | jq -er .base.ref)
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
  git fetch -q origin +main:refs/remotes/origin/main "+refs/heads/$base:refs/remotes/origin/$base" "+pull/$pr/head:refs/pr/$pr"
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
Review this branch against origin/$base using the review guidelines in AGENTS.md.
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
  # sed, not grep: a review with no findings is a success.
  sed -nE '/^[a-z]+-[a-z]+, [A-Z]+-[0-9]+, [^ ,]+, /p' "$out" | while IFS=', ' read -r env issue branch _; do
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

# Ships a container-use environment from the Linear agent's workspace, where
# its state lives. Codex, signed in on this host, runs `container-use merge`
# for the environment and `git push` to the issue's branch, and its rules
# allow exactly those two commands. Both run in the workspace through devpod
# ssh, in a worktree of its own: the shared checkout is moved to origin/main
# on every agent turn. The worktree starts at the issue's branch, or at
# origin/main when the branch does not exist yet, so the push is a
# fast-forward and never needs force.
#
# The push token is not stored on this host. ~/.toolbox/ship/ship.env holds
# only its pass:// reference, and `pass-cli run --env-file` resolves it, with
# the host's own Proton Pass session, at the moment ship-push and the check
# below need it. It is not in Codex's environment, and the Linear key never
# comes near. The ship action refuses when the host has no pass session; the
# job never logs in. After Codex exits, this script checks on GitHub that
# the environment's tip is on the branch, so a Codex that stopped early or
# only said it pushed is not a success. The result is $out:
# {env, branch, sha, status}.
SHIP_CREDENTIAL_HELPER=/workspaces/.ship-git-credential

# Runs the script in the workspace as `bash -s -- args`. The script travels
# in the command, not on stdin, which devpod ssh does not promise to forward.
# devpod prints its own messages too, so callers pick out marker lines.
ship_in_workspace() { # ws script send args... (SHIP_PUSH_PAT is forwarded if send is 1)
  local ws=$1 script=$2 send=$3
  shift 3
  devpod ssh "$ws" ${send:+--send-env SHIP_PUSH_PAT} \
    --command "echo $(printf %s "$script" | base64 -w0) | base64 -d | bash -s -- $*" </dev/null
}

SHIP_PREPARE='set -euo pipefail
env=$1 branch=$2 wt=$3 root=$4 helper=$5
cd "$root"
git fetch -q origin
git fetch -q container-use
tip=$(git rev-parse --verify -q "refs/remotes/container-use/$env") || { echo "no container-use environment $env in $root" >&2; exit 3; }
if git rev-parse --verify -q "refs/remotes/origin/$branch" >/dev/null; then start=refs/remotes/origin/$branch; else start=refs/remotes/origin/main; fi
if git merge-base --is-ancestor "$tip" "$start"; then echo "SHIP_ALREADY $(git rev-parse "$start")"; exit 0; fi
git worktree remove --force "$wt" 2>/dev/null || rm -rf "$wt"
git worktree prune
git worktree add -q --detach "$wt" "$start"
git config user.name >/dev/null || git config --global user.name toolbox
git config user.email >/dev/null || git config --global user.email toolbox@toolbox-host
printf "%s\n" "#!/bin/sh" "test \"\$1\" = get || exit 0" "echo username=x-access-token" "echo \"password=\$SHIP_PUSH_PAT\"" > "$helper"
chmod 755 "$helper"
echo "SHIP_READY $start"'

SHIP_VERIFY='set -euo pipefail
env=$1 branch=$2 wt=$3 root=$4 helper=$5
cd "$root"
git -c credential.helper= -c credential.helper="$helper" fetch -q origin "+refs/heads/$branch:refs/remotes/origin/$branch"
if ! git merge-base --is-ancestor "refs/remotes/container-use/$env" "refs/remotes/origin/$branch"; then
  echo "origin/$branch does not contain environment $env" >&2
  exit 5
fi
echo "SHIP_TIP $(git rev-parse "refs/remotes/origin/$branch")"
git worktree remove --force "$wt"'

run_ship() {
  set -euo pipefail
  local ws=$1 env=$2 branch=$3 out=$4 dir=$HOME/.toolbox/ship
  local root=/workspaces/$ws wt=/workspaces/ship-$2 args sha merge push mark
  args="$env $branch $wt $root $SHIP_CREDENTIAL_HELPER"
  mkdir -p "$dir/work" "$dir/codex/rules"

  mark=$(ship_in_workspace "$ws" "$SHIP_PREPARE" "" "$args" | sed -n 's/^SHIP_\(ALREADY\|READY\) /\1 /p')
  case $mark in
  "ALREADY "*)
    jq -n --arg env "$env" --arg branch "$branch" --arg sha "${mark#ALREADY }" \
      '{env: $env, branch: $branch, sha: $sha, status: "already on the branch"}' > "$out"
    return 0
    ;;
  "READY "*) ;;
  *) echo "could not prepare a worktree for $env in $ws" >&2; return 1 ;;
  esac

  # A prefix rule also matches a command with arguments added after it, and
  # devpod ssh takes the last --command. So the allowed commands are two
  # scripts that ignore their arguments and run the one command each; the
  # rules allow those scripts and nothing else. The environment and branch
  # passed the checks in the ship action, so they hold no quote or newline.
  merge="cd $wt && container-use merge $env"
  push="cd $wt && git -c credential.helper= -c credential.helper=$SHIP_CREDENTIAL_HELPER push origin HEAD:refs/heads/$branch"
  mkdir -p "$dir/bin"
  printf '#!/bin/bash\nexec devpod ssh %s --command %s\n' "$ws" "'$merge'" > "$dir/bin/ship-merge"
  printf '#!/bin/bash\nSHIP_PUSH_PAT=$(cat %s) || exit 1\nexport SHIP_PUSH_PAT\nexec devpod ssh %s --send-env SHIP_PUSH_PAT --command %s\n' \
    "$dir/push-token" "$ws" "'$push'" > "$dir/bin/ship-push"
  chmod 755 "$dir/bin/ship-merge" "$dir/bin/ship-push"
  cat > "$dir/codex/rules/default.rules" <<RULES
prefix_rule(
    pattern = ["$dir/bin/ship-merge"],
    justification = "container-use merge $env, in the ship worktree.",
    match = [["$dir/bin/ship-merge"]],
    not_match = [["$dir/bin/ship-other"]],
)
prefix_rule(
    pattern = ["$dir/bin/ship-push"],
    justification = "git push to $branch, without force.",
    match = [["$dir/bin/ship-push"]],
    not_match = [["$dir/bin/ship-other"]],
)
RULES
  ln -sfn "$HOME/.codex/auth.json" "$dir/codex/auth.json"

  # Any other command Codex tries runs in a read-only sandbox without
  # network. Its shell gets only the variables listed.
  (cd "$dir/work" && CODEX_HOME=$dir/codex codex exec --skip-git-repo-check \
    -c 'sandbox_mode="read-only"' -c 'approval_policy="never"' \
    -c 'shell_environment_policy.include_only=["PATH","HOME","USER","LOGNAME","SHELL","LANG","TMPDIR"]' \
    -o "$dir/last-message.md" - <<PROMPT
Ship the container-use environment $env to the branch $branch. Run these two commands, in this order, exactly as
written and nothing else; each one is already allowed. They take no arguments.

1. $dir/bin/ship-merge     (container-use merge $env)
2. $dir/bin/ship-push      (git push to $branch)

Run the second only if the first succeeded. If either fails, stop and print its output; do not retry, edit anything,
or try another command. Finish by printing one line: pushed, or the error.
PROMPT
  )

  # The postcondition is read from GitHub, not taken from Codex.
  sha=$(SHIP_PUSH_PAT=$(cat "$dir/push-token") ship_in_workspace "$ws" "$SHIP_VERIFY" 1 "$args" | sed -n 's/^SHIP_TIP //p')
  [ -n "$sha" ] || { echo "$env is not on $branch after the ship" >&2; return 1; }
  jq -n --arg env "$env" --arg branch "$branch" --arg sha "$sha" \
    '{env: $env, branch: $branch, sha: $sha, status: "pushed"}' > "$out"
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
  setsid nohup bash -c "$(declare -f git_auth api run_review)"'
    (run_review "$@"); echo $? > "'"$JOBS/$id.exit"'"' _ "$pr" "$model" "$JOBS/$id.md" \
    > "$JOBS/$id.log" 2>&1 < /dev/null &
  echo $! > "$JOBS/$id.pid"
  jq -n --argjson pr "$pr" '{pr: $pr, job_running: true}'
  ;;
ship)
  ws=$1 env=$2 branch=$3 id=ship
  # They go into a remote shell and a rules file: only plain names pass.
  [[ $env =~ ^[a-z]+-[a-z]+$ ]] || { echo "$env is not a container-use environment id" >&2; exit 2; }
  [[ $branch =~ ^[A-Za-z0-9._][A-Za-z0-9._/-]{0,99}$ && $branch != main ]] || { echo "$branch is not an issue branch" >&2; exit 2; }
  [ -s "$HOME/.toolbox/ship/push-token" ] || { echo "no push token: put one in $HOME/.toolbox/ship/push-token (mode 0600)" >&2; exit 2; }
  # One ship at a time: they share Codex's home, and its rules.
  refuse_if_busy "$id"
  rm -f "$JOBS/$id.exit" "$JOBS/$id.json" "$HOME/.toolbox/ship/last-message.md"
  setsid nohup bash -c "$(declare -p SHIP_CREDENTIAL_HELPER SHIP_PREPARE SHIP_VERIFY; declare -f ship_in_workspace run_ship)"'
    (run_ship "$@"); echo $? > "'"$JOBS/$id.exit"'"' _ "$ws" "$env" "$branch" "$JOBS/$id.json" \
    > "$JOBS/$id.log" 2>&1 < /dev/null &
  echo $! > "$JOBS/$id.pid"
  jq -n --arg env "$env" --arg branch "$branch" '{env: $env, branch: $branch, job_running: true}'
  ;;
ship-status)
  id=ship
  jq -n --argjson job_running "$(job_running "$id" && echo true || echo false)" \
    --argjson job_exit "$(cat "$JOBS/$id.exit" 2>/dev/null || echo null)" \
    --argjson result "$(cat "$JOBS/$id.json" 2>/dev/null || echo null)" \
    --arg codex "$(cat "$HOME/.toolbox/ship/last-message.md" 2>/dev/null || true)" \
    --arg log_tail "$(tail -n 40 "$JOBS/$id.log" 2>/dev/null || true)" \
    '{job_running: $job_running, job_exit: $job_exit, result: $result, codex: $codex, log_tail: $log_tail}'
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
