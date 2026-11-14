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
# check's Dagger Cloud token, for the trace each rerun links to.
export DAGGER_CLOUD_TOKEN_REF=pass://infra/dagger.cloud/DAGGER_CLOUD_TOKEN
# agent_ship's push token: can push this repository and nothing else.
export SHIP_PUSH_PAT_REF=pass://infra/github.com/GITHUB_TOKEN
export DEVCONTAINER_DIR=.dagger/internal/devenv-base/.devcontainer
# A shadow workspace is created from this config, which is the default one plus
# a docker volume <workspace>-home mounted at the container user's home, so the
# Claude login and conversation survive a rebuild. It reads the workspace's
# name from SHADOW_WORKSPACE (devcontainer.json's ${localEnv:...}), exported
# by run_up.
export SHADOW_DEVCONTAINER=.devcontainer/shadow/devcontainer.json
# A Linear agent working an issue, as seen from the host: the Claude
# runtime's claude-agent-sdk process, or the container-use MCP server either
# runtime starts for the length of a turn (the OpenRouter runtime has no
# other process of its own). host-lifecycle.sh uses the same pattern.
export AGENT_WORK_PATTERN='claude-agent-sdk|container-use stdio'
# Same order as keepalive/runner/bootstrap.go, plus start-openrouter-agent.sh
# (the second Linear agent, optional), which the keepalive does not start.
export AGENT_SCRIPTS="generate-env-files.sh tailscale-up.sh install-tools.sh start-linear-agent.sh start-openrouter-agent.sh start-cloudflared.sh check-linear-agent-webhook-live.sh"
JOBS=$HOME/.toolbox/jobs
mkdir -p "$JOBS"

# A job writes its exit code as its last step, so a job with one has
# finished even while its pid still answers (an unreaped zombie, or a pid
# reused after a reboot).
job_running() {
  [ -f "$JOBS/$1.pid" ] && [ ! -f "$JOBS/$1.exit" ] && kill -0 "$(cat "$JOBS/$1.pid")" 2>/dev/null
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
  local id=$1 ref=$2 agent=$3 shadow=${4:-0} s cfg=.devcontainer/devcontainer.json
  git_auth
  # Needed on every devpod up of a shadow workspace, not only the first: the
  # config's mount is resolved each time the container is (re)created.
  if [ "$shadow" = 1 ]; then
    cfg=$SHADOW_DEVCONTAINER
    export SHADOW_WORKSPACE=$id
  fi
  if [ "$(devpod status "$id" --output json 2>/dev/null | jq -r '.state // empty')" = "" ]; then
    devpod up "$id" --id "$id" --source "git:$REPO@$ref" --provider docker --ide none \
      --devcontainer-path "$cfg"
  else
    echo "== $id exists; starting it (ref $ref is only used on creation)"
    devpod up "$id" --ide none
  fi
  if [ "$shadow" = 1 ]; then
    # From the workspace's own checkout (the ref it was created from), unlike
    # the agent's scripts: no origin/main move, so a branch can test the script.
    # SHADOW_SESSION_ID, if the toolbox sent one, is a Claude session UUID, not
    # a secret, so it may show on devpod's command line.
    echo "== start-shadow.sh"
    devpod ssh "$id" ${SHADOW_SESSION_ID:+--set-env "SHADOW_SESSION_ID=$SHADOW_SESSION_ID"} \
      --command "bash /workspaces/$id/$DEVCONTAINER_DIR/start-shadow.sh" </dev/null
  fi
  [ "$agent" = 1 ] || return 0
  # The scripts run from the workspace's checkout, and so does every
  # container-use environment the agent creates. The agent server moves it
  # to origin/main before each turn; start the scripts from there too, not
  # from the ref the workspace was created with. If it cannot move, nothing
  # is started: older scripts would read Pass as they used to, and fail
  # further on with a less telling error than git's.
  devpod ssh "$id" --command "cd /workspaces/$id && git fetch -q origin && git checkout -q --detach origin/main" </dev/null || {
    echo "== could not move $id to origin/main (git's error is above); not starting its agents" >&2
    return 1
  }
  for s in $AGENT_SCRIPTS; do
    echo "== $s"
    if [ "$s" = tailscale-up.sh ]; then
      # The workspace logs in to Pass as its own agent, linear-agent-host,
      # with the token the toolbox sent as AGENT_PASS_TOKEN, never with the
      # toolbox's own.
      PROTON_PASS_PERSONAL_ACCESS_TOKEN=${AGENT_PASS_TOKEN:?the toolbox sent no AGENT_PASS_TOKEN} \
        devpod ssh "$id" --send-env PROTON_PASS_PERSONAL_ACCESS_TOKEN \
        --command "bash /workspaces/$id/$DEVCONTAINER_DIR/$s"
      # MagicDNS points the container's resolv.conf at 100.100.100.100, and
      # then public names stop resolving, so the next script's pass-cli
      # cannot reach Proton. Turned off here as well as in tailscale-up.sh,
      # which does it only when it joins the tailnet.
      devpod ssh "$id" --command 's=; [ "$(id -u)" = 0 ] || s=sudo
        $s tailscale --socket=/var/run/tailscale/tailscaled.sock set --accept-dns=false
        getent ahosts pass.proton.me >/dev/null || { echo "public names do not resolve in the container" >&2; exit 1; }'
    else
      devpod ssh "$id" --command "bash /workspaces/$id/$DEVCONTAINER_DIR/$s"
    fi
  done
}

# Runs a script in a workspace as `bash -s -- args`, for the shadow actions,
# cut off after secs. The script travels in the command, as for
# ship_in_workspace; the args must be plain tokens (the toolbox validates names
# and numbers; text is base64). devpod ssh on a stopped workspace would start
# it, so callers check its state first. --silent keeps devpod's own log lines
# out of the output.
in_workspace() { # ws secs script args...
  local ws=$1 secs=$2 script=$3 q
  shift 3
  q=$(printf ' %q' "$@")
  timeout "$secs" devpod ssh "$ws" --silent --start-services=false --agent-forwarding=false \
    --command "echo $(printf %s "$script" | base64 -w0) | base64 -d | bash -s --$q" </dev/null
}

# Cheap and read-only: what workspace_status reports as `shadow`. Herdr and
# Claude live in the container's ~/.local/bin, which a non-login shell lacks.
# logged_in is "unknown" when claude is missing or its status cannot be read.
SHADOW_PROBE='export PATH="$HOME/.local/bin:$PATH"
ws=$1 sess=false pane=false login=\"unknown\"
if herdr session list --json 2>/dev/null | jq -e --arg n "$ws" ".sessions[]? | select(.name == \$n and .running)" >/dev/null 2>&1; then
  sess=true
  herdr --session "$ws" pane list 2>/dev/null | jq -e "[.result.panes[]? | select(.agent == \"claude\")] | length > 0" >/dev/null 2>&1 && pane=true
fi
if command -v claude >/dev/null 2>&1; then
  l=$(timeout 15 env -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_API_KEY claude auth status --json 2>/dev/null | jq -c "if has(\"loggedIn\") then .loggedIn else \"unknown\" end" 2>/dev/null) || l=
  [ -z "$l" ] || login=$l
fi
jq -n --argjson sess "$sess" --argjson pane "$pane" --argjson login "$login" \
  --argjson st "$(cat "$HOME/.shadow/$ws.json" 2>/dev/null || echo null)" \
  "{herdr_session: \$sess, claude_pane: \$pane, logged_in: \$login, start: \$st}"'

# The shadow object of workspace_status. Only for a workspace that workspace_up
# made with shadow=true, and only while it runs and its up job is done: it never
# starts one. A probe that fails is reported, not hidden.
shadow_status() { # id
  local id=$1 probe="" why=""
  if [ "$(state "$id")" != Running ]; then
    why="the workspace is not running"
  elif job_running "$id"; then
    why="the workspace's up job is still running"
  elif ! probe=$(in_workspace "$id" 40 "$SHADOW_PROBE" "$id" 2>/dev/null) || ! jq -e . >/dev/null 2>&1 <<<"$probe"; then
    probe="" why="could not probe the workspace"
  fi
  # The attach command is for a person on the tailnet with SSH access to the
  # host. devpod ssh opening a TTY for herdr's TUI was not tested.
  jq -n --arg id "$id" --arg why "$why" --argjson probe "${probe:-null}" '
    ($probe // {herdr_session: null, claude_pane: null, logged_in: "unknown", start: null})
    + {attach: ("ssh -t toolbox@toolbox-host devpod ssh \($id) --start-services=false --agent-forwarding=false --command " + ("herdr --session \($id)" | @sh))}
    + (if $why != "" then {detail: $why} else {} end)'
}

# Reviews the PR with the host's Codex login, so AGENTS.md sets the criteria,
# and has Codex create a container-use environment and a Linear triage issue
# for each finding. Its final message, one line per finding, lands in $out.
# A Dagger check of a repository at a ref, for the toolbox's Linear rerun
# webhook. Only dagger runs here: the toolbox reads $out and writes Linear, so
# neither this job nor the check sees a Linear key. $out holds the check's exit
# code, which is its verdict, and the trace it linked to.
run_check() {
  set -euo pipefail
  local repo=$1 ref=$2 check=$3 run=$4 out=$5 log=$6 delivery=$7 dir=$HOME/.toolbox/checks/$(basename "$5" .json) code trace snapshot
  rm -rf "$dir" && mkdir -p "$dir"
  git clone -q --depth 1 --branch "$ref" "https://github.com/$repo.git" "$dir/repo"
  # Dagger reads a check's defaults from the repository's .env: a check that
  # takes a `run` gets the issue's, so one issue's reruns resume one session.
  echo "$(tr -d - <<< "$check" | tr '[:lower:]' '[:upper:]')_RUN=$run" >> "$dir/repo/.env"
  echo "DAGGER_CLOUD_TOKEN=$DAGGER_CLOUD_TOKEN_REF" > "$dir/runtime.env"
  # Keep per-delivery input outside the harness directory, so it cannot
  # invalidate the cached plan through the source tree's contents.
  echo "$(tr -d - <<< "$check" | tr '[:lower:]' '[:upper:]')_DELIVERY=$delivery" >> "$dir/runtime.env"
  cd "$dir/repo"
  # pass-cli run also resolves inherited pass:// values. Other host actions'
  # references must not request GitHub or Linear access for a check.
  unset SHIP_PUSH_PAT_REF LINEAR_API_KEY_REF DAGGER_CLOUD_TOKEN_REF
  local -a check_env=(--env-file .env --env-file "$dir/runtime.env")
  # Item-scoped Pass tokens use opaque item/share references. An operator
  # can override the clone's named references without changing the check repo.
  if [ -f "$HOME/.toolbox/check.env" ]; then
    check_env+=(--env-file "$HOME/.toolbox/check.env")
  fi
  code=0
  pass-cli run "${check_env[@]}" -- dagger check "$check" > "$log" 2>&1 || code=$?
  trace=$(sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -Eo 'https://dagger\.cloud/[^[:space:]]+' | tail -1 | sed 's/[),.;]*$//' || true)
  # Snapshot provenance is display data, never a verdict. Select only a
  # restored world explicitly tagged for this issue's run key.
  snapshot=$(sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -E "World: [0-9a-f]{64} .*run=$run(,|\\))" | sed -nE 's/.*World: ([0-9a-f]{64}) .*/\1/p' | tail -1 || true)
  jq -n --argjson exit "$code" --arg trace "$trace" --arg snapshot "$snapshot" '{exit: $exit, trace: $trace, snapshot: $snapshot}' > "$out"
  cd "$HOME" && rm -rf "$dir"
}

# Each environment's branch is then pushed under its issue's branch name, so
# Linear links it to the issue, and the pre-push hook's backup runs.
# Progress is kept per head, so a review the host stopped part way through
# resumes instead of filing its findings again (CIT-469): $out.published
# holds the head whose findings Codex finished filing, and a retry of that
# head only pushes and backs up. A retry after Codex was cut off mid-run asks
# Codex to look up what it already filed for this head first.
run_review() {
  set -euo pipefail
  local pr=$1 model=$2 out=$3 head=$4 dir=$HOME/.toolbox/reviews/$1 env=$HOME/.toolbox/linear.env hk base
  git_auth
  # Against the PR's own base: a stacked PR reviewed against main would also
  # get findings for the code it sits on.
  base=$(api "https://api.github.com/repos/null-hype/agent-plugins/pulls/$pr" | jq -er .base.ref)
  # Codex never sees the Linear key: its curl runs under `pass-cli run`,
  # which resolves this reference. Same login as tailscale-up.sh. pass-cli
  # refuses an agent session that gives no reason; Codex's shell inherits it.
  export PROTON_PASS_KEY_PROVIDER=fs
  export PROTON_PASS_AGENT_REASON="codex_review: file the review's findings in Linear"
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
  if [ "$(cat "$out.published" 2>/dev/null)" = "$head" ]; then
    echo "== findings for $head were already filed; resuming at the push"
  else
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
the environment id, and the line "Reviewed commit: $head". Before filing anything, query Linear for issues in
that team whose description contains "Reviewed commit: $head" and the PR URL: a finding already filed there
(an earlier run of this review was cut off) is reused, not filed again. Ask for the created issue's identifier and branchName, then attach
https://github.com/null-hype/agent-plugins/tree/<branchName> to the issue with attachmentLinkURL, titled
"Finding environment branch"; the environment is pushed there after you finish. Send each GraphQL request body on stdin to:
PROTON_PASS_KEY_PROVIDER=fs pass-cli run --env-file $env -- sh -c 'curl -fsS https://api.linear.app/graphql -H "Content-Type: application/json" -H "Authorization: \$LINEAR_API_KEY" --data @-'
Then print one line per finding: environment id, Linear issue identifier, Linear branchName, title.
PROMPT
    echo "$head" > "$out.published"
  fi
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
# pass-cli refuses an agent session that does not say why it reads a secret.
SHIP_PASS_REASON="agent_ship: push the retained implementation branch"

# Runs the script in the workspace as `bash -s -- args`. The script travels
# in the command, not on stdin, which devpod ssh does not promise to forward.
# devpod prints its own messages too, so callers pick out marker lines.
ship_in_workspace() { # ws script send args... (SHIP_PUSH_PAT, resolved by pass-cli, is forwarded if send is 1)
  local ws=$1 script=$2 send=$3 resolve=()
  shift 3
  [ -z "$send" ] || resolve=(pass-cli run --env-file "$HOME/.toolbox/ship/ship.env" --)
  "${resolve[@]}" devpod ssh "$ws" ${send:+--send-env SHIP_PUSH_PAT} \
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
  # Codex's shell passes on only the variables listed below, so ship-push
  # sets the reason pass-cli requires of an agent session itself.
  printf '#!/bin/bash\nexport PROTON_PASS_KEY_PROVIDER=fs\nexport PROTON_PASS_AGENT_REASON="%s"\nexec pass-cli run --env-file %s -- devpod ssh %s --send-env SHIP_PUSH_PAT --command %s\n' \
    "$SHIP_PASS_REASON" "$dir/ship.env" "$ws" "'$push'" > "$dir/bin/ship-push"
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
  sha=$(ship_in_workspace "$ws" "$SHIP_VERIFY" 1 "$args" | sed -n 's/^SHIP_TIP //p')
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
  # The idle clock and lease, or null on a host without toolbox-lifecycle.
  lifecycle=$(toolbox-lifecycle status 2>/dev/null || echo null)
  tailscale status --json 2>/dev/null |
    jq --argjson lifecycle "$lifecycle" '{ready: true, tailnet: {state: .BackendState, name: (.Self.DNSName // "" | rtrimstr(".")), ips: (.Self.TailscaleIPs // []), online: (.Self.Online // false)}, lifecycle: $lifecycle}' ||
    jq -n --argjson lifecycle "$lifecycle" '{ready: true, tailnet: {state: "NotInstalled"}, lifecycle: $lifecycle}'
  ;;
activity)
  # Everything that counts as work in progress, for host_stop and host_wake:
  # every toolbox job (workspace up, ship, review), not only the ones named
  # after a workspace, and the Linear agent working an issue. lifecycle is
  # the host's idle clock and lease, or null on a host without it.
  # A finished job is an observation of no work, not a failure (CIT-470).
  for f in "$JOBS"/*.pid; do
    [ -f "$f" ] || continue
    if job_running "$(basename "$f" .pid)"; then basename "$f" .pid; fi
  done | jq -R . | jq -s --argjson agent "$(pgrep -f "$AGENT_WORK_PATTERN" >/dev/null 2>&1 && echo true || echo false)" \
    --argjson lifecycle "$(toolbox-lifecycle status 2>/dev/null || echo null)" \
    '{jobs: ., agent_running: $agent, lifecycle: $lifecycle}'
  ;;
agent-live)
  # The agent's live webhook check, run now: a start job that once exited 0
  # says nothing about whether node and the tunnel are still up (CIT-467).
  if out=$(timeout 90 devpod ssh "$1" --command "bash /workspaces/$1/$DEVCONTAINER_DIR/check-linear-agent-webhook-live.sh" </dev/null 2>&1) &&
    grep -q '^LIVE_WEBHOOK_CHECK: OK' <<<"$out"; then
    live=true
  else
    live=false
  fi
  jq -n --argjson live "$live" --arg detail "$(tail -n 5 <<<"$out")" '{live: $live, detail: $detail}'
  ;;
list)
  devpod list --output json | jq -r '.[]?.id' | while read -r id; do
    workspace_json "$id"
  done | jq -s .
  ;;
status)
  id=$1
  shadow=null
  if [ -f "$JOBS/$id.shadow" ]; then shadow=$(shadow_status "$id"); fi
  jq -n --argjson ws "$(workspace_json "$id")" \
    --argjson job_exit "$(cat "$JOBS/$id.exit" 2>/dev/null || echo null)" \
    --arg log_tail "$(tail -n 40 "$JOBS/$id.log" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' || true)" \
    --argjson shadow "$shadow" \
    '$ws + {job_exit: $job_exit, log_tail: $log_tail} + (if $shadow != null then {shadow: $shadow} else {} end)'
  ;;
up)
  id=$1 ref=$2 agent=$3 shadow=${4:-0}
  refuse_if_busy "$id"
  rm -f "$JOBS/$id.exit"
  # Marks the workspace as a shadow, for status; delete removes it with the job.
  if [ "$shadow" = 1 ]; then touch "$JOBS/$id.shadow"; fi
  setsid nohup bash -c "$(declare -f git_auth run_up)"'
    (run_up "$@"); echo $? > "'"$JOBS/$id.exit"'"' _ "$id" "$ref" "$agent" "$shadow" \
    > "$JOBS/$id.log" 2>&1 < /dev/null &
  echo $! > "$JOBS/$id.pid"
  workspace_json "$id"
  ;;
review)
  pr=$1 model=${2:-} id=review-$1
  refuse_if_busy "$id"
  # A head that was already reviewed successfully is not reviewed again: a
  # second review would file every finding twice. A new commit on the PR is a
  # new head and is reviewed.
  pull=$(api "https://api.github.com/repos/null-hype/agent-plugins/pulls/$pr")
  # A fork's PR is a stranger's code, and its AGENTS.md would be Codex's
  # instructions, with network and the host's Pass session. Never review one.
  if [ "$(jq -r '.head.repo.full_name // empty' <<< "$pull")" != null-hype/agent-plugins ]; then
    echo "PR #$pr is not from a branch of null-hype/agent-plugins; codex_review only reviews the repository's own branches" >&2
    exit 1
  fi
  head=$(jq -er .head.sha <<< "$pull")
  if [ "$(cat "$JOBS/$id.exit" 2>/dev/null)" = 0 ] && [ "$(cat "$JOBS/$id.sha" 2>/dev/null)" = "$head" ]; then
    jq -n --argjson pr "$pr" --arg head "$head" \
      '{pr: $pr, job_running: false, duplicate: true, head: $head, detail: "this head was already reviewed; codex_review_status has the findings"}'
    exit 0
  fi
  # The findings of a head whose filing finished are kept for the resumed
  # push; anything else starts over.
  resumed=false
  if [ "$(cat "$JOBS/$id.md.published" 2>/dev/null)" = "$head" ]; then
    resumed=true
  else
    rm -f "$JOBS/$id.md" "$JOBS/$id.md.published"
  fi
  echo "$head" > "$JOBS/$id.sha"
  rm -f "$JOBS/$id.exit" "$JOBS/$id.interrupted"
  setsid nohup bash -c "$(declare -f git_auth api run_review)"'
    (run_review "$@"); echo $? > "'"$JOBS/$id.exit"'"' _ "$pr" "$model" "$JOBS/$id.md" "$head" \
    > "$JOBS/$id.log" 2>&1 < /dev/null &
  echo $! > "$JOBS/$id.pid"
  jq -n --argjson pr "$pr" --argjson resumed "$resumed" '{pr: $pr, job_running: true, resumed: $resumed}'
  ;;
ship)
  ws=$1 env=$2 branch=$3 id=ship
  # They go into a remote shell and a rules file: only plain names pass.
  [[ $env =~ ^[a-z]+-[a-z]+$ ]] || { echo "$env is not a container-use environment id" >&2; exit 2; }
  [[ $branch =~ ^[A-Za-z0-9._][A-Za-z0-9._/-]{0,99}$ && $branch != main ]] || { echo "$branch is not an issue branch" >&2; exit 2; }
  # The push token is resolved from Proton Pass by the host's own session.
  # The reason covers this check and the job's check on GitHub after the push.
  export PROTON_PASS_KEY_PROVIDER=fs
  export PROTON_PASS_AGENT_REASON=$SHIP_PASS_REASON
  # A host that was recreated has no session: log in with the token the
  # toolbox sends, as review does.
  if ! pass-cli info >/dev/null 2>&1 && [ -n "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:-}" ]; then
    pass-cli logout --force >/dev/null 2>&1 || true
    pass-cli login >/dev/null 2>&1 || true
  fi
  pass-cli info >/dev/null 2>&1 || { echo "no Proton Pass session on this host, so the push token cannot be resolved: log pass-cli in once on the host (PROTON_PASS_KEY_PROVIDER=fs pass-cli login)" >&2; exit 2; }
  install -d -m 700 "$HOME/.toolbox/ship"
  # The plaintext copy an earlier version of this action read.
  rm -f "$HOME/.toolbox/ship/push-token"
  echo "SHIP_PUSH_PAT=$SHIP_PUSH_PAT_REF" > "$HOME/.toolbox/ship/ship.env"
  # One ship at a time: they share Codex's home, and its rules.
  refuse_if_busy "$id"
  rm -f "$JOBS/$id.exit" "$JOBS/$id.json" "$HOME/.toolbox/ship/last-message.md"
  # Which ship this job is, for ship-status while it runs and after it
  # fails: a caller must tell its own ship from another's (CIT-523).
  jq -n --arg env "$env" --arg branch "$branch" '{env: $env, branch: $branch}' > "$JOBS/$id.request.json"
  setsid nohup bash -c "$(declare -p SHIP_CREDENTIAL_HELPER SHIP_PASS_REASON SHIP_PREPARE SHIP_VERIFY; declare -f ship_in_workspace run_ship)"'
    (run_ship "$@"); echo $? > "'"$JOBS/$id.exit"'"' _ "$ws" "$env" "$branch" "$JOBS/$id.json" \
    > "$JOBS/$id.log" 2>&1 < /dev/null &
  echo $! > "$JOBS/$id.pid"
  jq -n --arg env "$env" --arg branch "$branch" '{env: $env, branch: $branch, job_running: true}'
  ;;
ship-status)
  id=ship
  jq -n --argjson job_running "$(job_running "$id" && echo true || echo false)" \
    --argjson job_exit "$(cat "$JOBS/$id.exit" 2>/dev/null || echo null)" \
    --argjson request "$(cat "$JOBS/$id.request.json" 2>/dev/null || echo null)" \
    --argjson result "$(cat "$JOBS/$id.json" 2>/dev/null || echo null)" \
    --arg codex "$(cat "$HOME/.toolbox/ship/last-message.md" 2>/dev/null || true)" \
    --arg log_tail "$(tail -n 40 "$JOBS/$id.log" 2>/dev/null || true)" \
    '{job_running: $job_running, job_exit: $job_exit, request: $request, result: $result, codex: $codex, log_tail: $log_tail}'
  ;;
check)
  delivery=$1 repo=$2 ref=$3 check=$4 run=$5 id=check-$1
  # They go into a clone, a .env and a command line: only plain names pass.
  [[ $delivery =~ ^[A-Za-z0-9-]+$ ]] || { echo "invalid delivery $delivery" >&2; exit 2; }
  [[ $repo = null-hype/worlds ]] || { echo "unsupported repository $repo" >&2; exit 2; }
  [[ $ref =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "invalid ref $ref" >&2; exit 2; }
  [[ $check =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "invalid check $check" >&2; exit 2; }
  [[ $run =~ ^[a-z0-9-]+$ ]] || { echo "invalid run $run" >&2; exit 2; }
  # Linear redelivers a webhook it thinks failed: one job per delivery.
  if [ -f "$JOBS/$id.exit" ] || job_running "$id"; then
    jq -n --arg id "$id" '{job: $id, duplicate: true}'
    exit 0
  fi
  export PROTON_PASS_KEY_PROVIDER=fs
  export PROTON_PASS_AGENT_REASON="check rerun: $check on $repo for Linear"
  if ! pass-cli info >/dev/null 2>&1 && [ -n "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:-}" ]; then
    pass-cli logout --force >/dev/null 2>&1 || true
    pass-cli login >/dev/null 2>&1 || true
  fi
  pass-cli info >/dev/null 2>&1 || { echo "no Proton Pass session on this host, so the check's secrets cannot be resolved" >&2; exit 2; }
  rm -f "$JOBS/$id.exit" "$JOBS/$id.json" "$JOBS/$id.dagger.log"
  setsid nohup bash -c "$(declare -p DAGGER_CLOUD_TOKEN_REF; declare -f run_check)"'
    (run_check "$@"); echo $? > "'"$JOBS/$id.exit"'"' _ "$repo" "$ref" "$check" "$run" "$JOBS/$id.json" "$JOBS/$id.dagger.log" "$delivery" \
    > "$JOBS/$id.log" 2>&1 < /dev/null &
  echo $! > "$JOBS/$id.pid"
  jq -n --arg id "$id" '{job: $id, duplicate: false, job_running: true}'
  ;;
check-status)
  id=check-$1
  # log_tail is the check's own output when it ran, else the job's.
  if [ -s "$JOBS/$id.dagger.log" ]; then tail_of=$JOBS/$id.dagger.log; else tail_of=$JOBS/$id.log; fi
  jq -n --argjson job_running "$(job_running "$id" && echo true || echo false)" \
    --argjson job_exit "$(cat "$JOBS/$id.exit" 2>/dev/null || echo null)" \
    --argjson result "$(cat "$JOBS/$id.json" 2>/dev/null || echo null)" \
    --arg log_tail "$(tail -n 15 "$tail_of" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' || true)" \
    '{job_running: $job_running, job_exit: $job_exit, result: $result, log_tail: $log_tail}'
  ;;
review-status)
  id=review-$1
  jq -n --argjson job_running "$(job_running "$id" && echo true || echo false)" \
    --argjson job_exit "$(cat "$JOBS/$id.exit" 2>/dev/null || echo null)" \
    --arg findings "$(cat "$JOBS/$id.md" 2>/dev/null || true)" \
    --arg log_tail "$(tail -n 40 "$JOBS/$id.log" 2>/dev/null || true)" \
    '{job_running: $job_running, job_exit: $job_exit, findings: $findings, log_tail: $log_tail}'
  ;;
shadow-list)
  # The workspace's Herdr session: its agents and panes, as Herdr prints them.
  ws=$1
  [ "$(state "$ws")" = Running ] || { echo "workspace $ws is not running; workspace_up starts it" >&2; exit 1; }
  out=$(in_workspace "$ws" 60 'export PATH="$HOME/.local/bin:$PATH"
herdr --session "$1" agent list
herdr --session "$1" pane list' "$ws")
  jq -s '{agents: .[0].result.agents, panes: .[1].result.panes}' <<<"$out"
  ;;
shadow-read)
  ws=$1 target=$2 lines=$3
  [ "$(state "$ws")" = Running ] || { echo "workspace $ws is not running; workspace_up starts it" >&2; exit 1; }
  out=$(in_workspace "$ws" 60 'export PATH="$HOME/.local/bin:$PATH"
herdr --session "$1" pane read "$2" --source recent-unwrapped --lines "$3"' "$ws" "$target" "$lines")
  jq -n --arg target "$target" --arg text "$out" '{target: $target, text: $text}'
  ;;
shadow-prompt)
  # text64 is the prompt, base64: it must not meet a shell. timeout is in
  # milliseconds, for herdr; the host's own cut-off is a little longer.
  ws=$1 target=$2 timeout_ms=$3 text64=$4
  [ "$(state "$ws")" = Running ] || { echo "workspace $ws is not running; workspace_up starts it" >&2; exit 1; }
  out=$(in_workspace "$ws" $((timeout_ms / 1000 + 20)) 'export PATH="$HOME/.local/bin:$PATH"
herdr --session "$1" agent prompt "$2" "$(printf %s "$4" | base64 -d)" --wait --timeout "$3"' "$ws" "$target" "$timeout_ms" "$text64")
  jq -c . <<<"$out" 2>/dev/null || jq -n --arg out "$out" '{output: $out}'
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
