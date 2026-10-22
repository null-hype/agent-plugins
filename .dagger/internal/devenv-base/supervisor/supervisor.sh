#!/usr/bin/env bash
# The supervisor: one Claude session that lives across hourly runs (CIT-443,
# CIT-472). It looks at everything, and its whole output is a changeset: what
# Linear should look like next. This script checks that changeset and makes
# it a pull request that merges itself once its checks are green. The next
# run applies it with the deployed workflow on Render. Merging is applying.
#
#   1. restore  ~/.claude from the newest restic snapshot tagged `supervisor`,
#               so the session remembers earlier runs;
#   2. clone the repo at CALIBRATION_BASE, start `apply` on Render on the
#      changeset that merged last time (apply-changeset.sh), build the
#      workflow, wait for the apply, start
#      `render workflows dev` and run the read-only `plan` task on it;
#   3. continue the session (`claude --continue`, from /workspaces/agent-plugins)
#      with prompt.md and the plan. It reads Linear and the toolbox, writes
#      neither, and ends with the changeset's Pkl body;
#   4. render it through workflow/pkl/Changeset.pkl, which refuses a changeset
#      that does not type-check, with `seen` filled in from the plan. One that
#      does not render goes back to the session once, with the error;
#   5. dry-run the `apply` task on the dev server against that tree: the test;
#   6. commit changeset.pkl and changeset.json on CALIBRATION_BRANCH, open (or
#      update) one PR, and turn on auto-merge;
#   7. back up ~/.claude, whether or not any of that worked, so the next run
#      remembers a failure rather than starting from before it.
#
# `claude --continue`, not `--resume <id>`: there is one session, so there is
# no id to keep. Claude files sessions by working directory and --continue
# picks the newest one there. A foreground `claude -p`, not `--bg`: the Render
# container ends when this command exits.
#
# The session cannot move anything itself. It holds the toolbox's read-only
# tools and Linear's read tools; every tool that writes, starts, stops,
# deletes or dispatches is named in --disallowedTools, and --strict-mcp-config
# keeps any other MCP server out. Its changes reach Linear only through the
# merged changeset.
#
# One Render service, so Render's single-run guarantee means a run still
# going when the next is due delays that next one. SUPERVISOR_TIMEOUT stays
# below the hour for that reason.
#
# SUPERVISOR_MODE=calibrate runs the same thing as a one-off: a fresh session
# with no restic and no Remote Control, on a cheap model, whose PR is only
# proposed unless CALIBRATION_MERGE=1. See README.md.
#
# Usage: supervisor.sh                (from Render: the image entrypoint)
#        supervisor.sh --bounded-run  (itself, re-executed under the timeout)
#        supervisor.sh --resolved     (itself, re-executed under pass-cli run)
set -euo pipefail

# Bound the whole run, the Proton Pass login included: a login left
# unbounded can hang the job (observed for the keepalive on 2026-09-06), and
# the single-run guarantee turns a hung run into a *late* next tick rather
# than an overlapping one. It must outlast SUPERVISOR_CLAUDE_TIMEOUT with
# room for the restore before and the backup after, or a timed-out claude
# would take the backup down with it.
case "${1:-}" in
  --bounded-run | --resolved) ;;
  *)
    exec timeout --signal=TERM --kill-after=60s "${SUPERVISOR_TIMEOUT:-50m}" \
      bash "$0" --bounded-run "$@"
    ;;
esac
stage=$1
shift

MODE=${SUPERVISOR_MODE:-tick}
case "$MODE" in
  tick | calibrate) ;;
  *) echo "supervisor: SUPERVISOR_MODE must be tick or calibrate, got: $MODE" >&2; exit 1 ;;
esac

: "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:?PROTON_PASS_PERSONAL_ACCESS_TOKEN must be set}"
TOOLBOX_URL=${TOOLBOX_URL:-https://toolbox-spike.onrender.com/mcp}
LINEAR_MCP_URL=${LINEAR_MCP_URL:-https://mcp.linear.app/mcp}
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESTIC_TAG=supervisor
# The seed session was made here, and Claude files sessions under the
# directory's own name: the path with every non-alphanumeric turned into a
# hyphen.
SESSION_DIR=/workspaces/agent-plugins
SESSION_PROJECT=-workspaces-agent-plugins

export PROTON_PASS_KEY_PROVIDER=${PROTON_PASS_KEY_PROVIDER:-fs}

if [ "$stage" = --bounded-run ]; then
  # A calibration resolves its own, smaller set: no restic, since it keeps no
  # transcript, and a GitHub token, since its output is a pull request.
  if [ "$MODE" = calibrate ]; then
    ENV_FILE=$DIR/calibrate.env
    export PROTON_PASS_AGENT_REASON="supervisor: resolve the Claude Code token, Linear key, toolbox token and GitHub token for a plan-only calibration"
  else
    ENV_FILE=$DIR/supervisor.env
    export PROTON_PASS_AGENT_REASON="supervisor: resolve the Claude Code token, Linear key, toolbox token, GitHub token and restic secrets for an hourly run"
  fi

  echo "supervisor: checking Proton Pass session"
  if ! timeout --foreground --kill-after=10s 60s pass-cli info > /dev/null 2>&1; then
    timeout --foreground --kill-after=10s 60s pass-cli logout --force > /dev/null 2>&1 || true
    echo "supervisor: logging in to Proton Pass"
    timeout --foreground --kill-after=10s 2m pass-cli login ||
      { echo "supervisor: could not log in to Proton Pass; every secret, the toolbox token included, comes from it" >&2; exit 1; }
  fi

  # Only pass:// references are in this file; the values are resolved by
  # pass-cli run and never touch disk.
  pass-cli run --env-file "$ENV_FILE" -- bash "$0" --resolved
  exit $?
fi

# --resolved: the secrets are in the environment from here on.
: "${CLAUDE_CODE_OAUTH_TOKEN:?CLAUDE_CODE_OAUTH_TOKEN must come from the pass env file}"
: "${LINEAR_API_KEY:?LINEAR_API_KEY must come from the pass env file}"
: "${TOOLBOX_TOKEN:?TOOLBOX_TOKEN must come from the pass env file}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN must come from the pass env file (the changeset PR)}"
if [ "$MODE" = tick ]; then
  : "${GCP_SERVICE_ACCOUNT_KEY:?GCP_SERVICE_ACCOUNT_KEY must come from the pass env file (restic)}"
  : "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY must come from the pass env file}"
  : "${RESTIC_PASSWORD:?RESTIC_PASSWORD must come from the pass env file}"
fi

# The toolbox's read-only tools and Linear's read tools: the session's
# changes go into the changeset, which merging applies. Every tool that
# writes, starts, stops, deletes or dispatches is spelled out as disallowed as
# well, so an allowlist that ever fails open still cannot change anything.
# Bash and the file-editing tools are disallowed for the same reason: with
# Bash the model could reach the toolbox over curl and route around this list.
ALLOWED_TOOLS="mcp__toolbox__ping
mcp__toolbox__host_status
mcp__toolbox__workspace_list
mcp__toolbox__workspace_status
mcp__toolbox__codespace_status
mcp__toolbox__codex_review_status
mcp__toolbox__agent_ship_status
mcp__linear__list_issues
mcp__linear__get_issue
mcp__linear__list_comments
mcp__linear__list_issue_labels
mcp__linear__list_issue_statuses
mcp__linear__get_issue_status
mcp__linear__list_releases
mcp__linear__get_release
mcp__linear__list_projects
mcp__linear__get_project
mcp__linear__list_teams
mcp__linear__get_team
mcp__linear__list_users
mcp__linear__get_user
mcp__linear__list_documents
mcp__linear__get_document"
DISALLOWED_TOOLS="mcp__toolbox__host_start
mcp__toolbox__host_stop
mcp__toolbox__host_wake
mcp__toolbox__agent_start
mcp__toolbox__agent_ship
mcp__toolbox__workspace_up
mcp__toolbox__workspace_stop
mcp__toolbox__workspace_delete
mcp__toolbox__codespace_start
mcp__toolbox__codespace_stop
mcp__toolbox__codespace_rebuild
mcp__toolbox__codex_review
mcp__linear__save_issue
mcp__linear__save_comment
mcp__linear__delete_comment
mcp__linear__save_issue_label
mcp__linear__create_issue_label
mcp__linear__create_attachment
mcp__linear__delete_attachment
mcp__linear__save_document
mcp__linear__save_project
mcp__linear__save_milestone
mcp__linear__save_release
mcp__linear__save_release_note
mcp__linear__save_status_update
mcp__linear__save_initiative
mcp__linear__share_issue
mcp__linear__unshare_issue
mcp__linear__mark_notification
mcp__linear__save_diff_comment
mcp__linear__submit_diff_review
mcp__linear__resolve_diff_thread
mcp__linear__merge_diff
mcp__linear__update_diff
Bash
Write
Edit
NotebookEdit
WebFetch
Task"

MCP_FILE=$(mktemp)
GCS_KEY_FILE=$(mktemp)
# The run's scratch: the clone of the repo and the dev server's pid.
CAL_DIR=""
dev_pid=""
# Set once the session is restored: from then on, every exit backs it up.
restored=""
cleanup() {
  local rc=$? backup_rc=0
  if [ -n "$dev_pid" ]; then
    kill "$dev_pid" 2> /dev/null || true
    wait "$dev_pid" 2> /dev/null || true
  fi
  # 7. Back up, whatever happened. From $HOME with a relative path, so the
  # snapshot holds /.claude/... and restores with the --target and --exclude
  # below; `restic backup ~/.claude` would store /root/.claude/... and restore
  # one level too deep, with the excludes matching nothing.
  if [ -n "$restored" ]; then
    echo "supervisor: backing up the session to restic tag $RESTIC_TAG"
    (cd "$HOME" && restic backup .claude --tag "$RESTIC_TAG") || backup_rc=$?
    if [ "$backup_rc" -ne 0 ]; then
      echo "supervisor: restic backup exited $backup_rc -- the next run will continue from an older transcript" >&2
      [ "$rc" -ne 0 ] || rc=1
    fi
  fi
  rm -f "$MCP_FILE" "$GCS_KEY_FILE"
  [ -z "$CAL_DIR" ] || rm -rf "$CAL_DIR"
  exit "$rc"
}
trap cleanup EXIT
chmod 600 "$MCP_FILE" "$GCS_KEY_FILE"
# Both bearer tokens reach claude through this file, never through a command
# line: argv is readable by every process in the container.
#
# Linear is declared here rather than left to the claude.ai connector. A
# CLAUDE_CODE_OAUTH_TOKEN is an inference-only token, and without the
# user:mcp_servers scope Claude Code loads no claude.ai connector at all
# (debug log: "[claudeai-mcp] Missing user:mcp_servers scope"), with or
# without --strict-mcp-config. So --strict-mcp-config costs the Linear tools
# nothing -- they were never there -- and an explicit server is what provides
# them.
jq -n \
  --arg toolbox_url "$TOOLBOX_URL" --arg toolbox_auth "Bearer $TOOLBOX_TOKEN" \
  --arg linear_url "$LINEAR_MCP_URL" --arg linear_auth "Bearer $LINEAR_API_KEY" \
  '{mcpServers: {
      toolbox: {type: "http", url: $toolbox_url, headers: {Authorization: $toolbox_auth}},
      linear:  {type: "http", url: $linear_url,  headers: {Authorization: $linear_auth}}
  }}' > "$MCP_FILE"

now=$(date -u +%FT%TZ)

# claude's exit: a run whose claude failed has no changeset.
check_claude() {
  # 124 is timeout's TERM, 137 its KILL after the grace period.
  case "$claude_rc" in
    0) ;;
    124 | 137)
      echo "supervisor: claude timed out after $claude_timeout -- this $MODE has no changeset" >&2
      exit 1
      ;;
    *)
      echo "supervisor: claude exited $claude_rc -- this $MODE has no changeset" >&2
      exit 1
      ;;
  esac
}

# 1. Restore the newest snapshot under the tag. Every run backs up the whole
# of ~/.claude, so the newest one is the session as the last run left it. No
# snapshot is a failed run -- continuing nothing would quietly start a
# different, amnesiac session.
if [ "$MODE" = tick ]; then
  # The GCS backend wants GOOGLE_APPLICATION_CREDENTIALS to point at a key
  # file, not the inline JSON pass-cli resolves.
  printf %s "$GCP_SERVICE_ACCOUNT_KEY" > "$GCS_KEY_FILE"
  export GOOGLE_APPLICATION_CREDENTIALS=$GCS_KEY_FILE
  echo "supervisor: restoring the newest snapshot tagged $RESTIC_TAG"
  snap=$(restic snapshots --json --tag "$RESTIC_TAG" |
    jq -r '(. // []) | max_by(.time) | (.id // empty)') ||
    { echo "supervisor: restic snapshots failed" >&2; exit 1; }
  [ -n "$snap" ] || {
    echo "supervisor: no snapshot tagged $RESTIC_TAG" >&2
    exit 1
  }
  # Leave out the runtime state of the background daemon: its lock names a
  # pid from the old machine, and stale job records make claude think the
  # session is still running.
  restic restore "$snap" --target "$HOME" \
    --exclude "/.claude/daemon*" --exclude /.claude/jobs
  # ~/.claude.json (workspace trust, the account) lives outside ~/.claude,
  # but Claude keeps copies of it inside.
  if [ ! -e "$HOME/.claude.json" ]; then
    # shellcheck disable=SC2012 # newest by mtime; the names are Claude's own
    claude_json_backup=$(ls -t "$HOME"/.claude/backups/.claude.json.backup.* 2> /dev/null | head -1 || true)
    [ -z "$claude_json_backup" ] || cp "$claude_json_backup" "$HOME/.claude.json"
  fi
  # --continue only looks in the current directory's project, so a snapshot
  # without a session there would start a fresh one.
  ls "$HOME"/.claude/projects/"$SESSION_PROJECT"/*.jsonl > /dev/null 2>&1 || {
    echo "supervisor: restoring snapshot $snap did not produce a session for $SESSION_DIR" >&2
    exit 1
  }
  restored=1
  mkdir -p "$SESSION_DIR"
fi

# 2-6: the changeset. Nothing here deploys or writes to Linear: the dev
# server only simulates Render and apply only ever runs dry. A changeset
# reaches Linear only through the merge, and the apply on Render the next
# run starts.
CALIBRATION_REPO=${CALIBRATION_REPO:-null-hype/agent-plugins}
CALIBRATION_REMOTE=${CALIBRATION_REMOTE:-https://github.com/$CALIBRATION_REPO.git}
CALIBRATION_BASE=${CALIBRATION_BASE:-main}
# main's calibration PR lives on supervisor/calibration. A calibration of
# another branch gets its own, so it never force-pushes over main's PR.
if [ "$CALIBRATION_BASE" = main ]; then
  CALIBRATION_BRANCH=${CALIBRATION_BRANCH:-supervisor/calibration}
else
  CALIBRATION_BRANCH=${CALIBRATION_BRANCH:-supervisor/calibration-$(printf '%s' "$CALIBRATION_BASE" | tr -c 'A-Za-z0-9._-' '-')}
fi
WORKFLOW_PATH=.dagger/internal/devenv-base/workflow
# The SDK's local mode talks to the dev server here.
export RENDER_USE_LOCAL_DEV=true
export RENDER_LOCAL_DEV_URL=${RENDER_LOCAL_DEV_URL:-http://127.0.0.1:8120}
# gh reads GH_TOKEN, and git asks gh for credentials, so the token is on
# no argv and in no file.
export GH_TOKEN=$GITHUB_TOKEN

CAL_DIR=$(mktemp -d)
repo=$CAL_DIR/repo
echo "supervisor: working against $CALIBRATION_REPO@$CALIBRATION_BASE"
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' \
  clone --quiet --depth 1 --branch "$CALIBRATION_BASE" "$CALIBRATION_REMOTE" "$repo" ||
  { echo "supervisor: could not clone $CALIBRATION_BASE" >&2; exit 1; }
git -C "$repo" config credential.helper '!gh auth git-credential'
base_sha=$(git -C "$repo" rev-parse HEAD)

# Apply what merged last time. The changeset on main is the previous run's
# plan, auto-merged once its checks passed; Render deployed it long since.
# This run starts the deployed Workflow's `apply` task on it, unless it
# already applied, and waits for it just before planning (below), so the plan
# is made on Linear as the last one left it. Nothing on GitHub is involved.
# The applied changeset's hash and task run are kept with the session; one
# whose apply failed is started again. Apply is idempotent.
APPLY_STATE=$HOME/.claude/supervisor-apply
apply_changeset() { "${APPLY_CHANGESET:-$DIR/apply-changeset.sh}" "$@"; }
apply_run=""
if [ "$MODE" = tick ] && [ "$CALIBRATION_BASE" = main ] && [ -f "$repo/$WORKFLOW_PATH/changeset.json" ]; then
  want=$(sha256sum < "$repo/$WORKFLOW_PATH/changeset.json" | cut -c1-16)
  had="" run=""
  [ ! -s "$APPLY_STATE" ] || read -r had run < "$APPLY_STATE"
  mkdir -p "${APPLY_STATE%/*}"
  if [ "$had" = "$want" ] && apply_changeset status "$run" > /dev/null; then
    echo "supervisor: main's changeset is already applied (run $run)"
  elif apply_run=$(apply_changeset start "$base_sha"); then
    echo "$want $apply_run" > "$APPLY_STATE"
    echo "SUPERVISOR_APPLY: started run=$apply_run"
  else
    echo "failed" > "$APPLY_STATE"
    echo "supervisor: could not start the apply of $base_sha; the next run starts it again" >&2
  fi
fi

# A shipped branch gets a pull request. agent_ship stops at a pushed branch,
# so without this its work waits for a person to notice (#240 sat for two
# days). Every recent `cit-<n>-…` branch with commits main lacks and no PR,
# open or closed, gets one, titled from its issue and last commit. The hourly
# run only: a calibration opens nothing but its own PR. A failure here is
# loud but leaves the changeset to go on.
if [ "$MODE" = tick ]; then
  since=$(date -u -d "-${SHIPPED_PR_DAYS:-14} days" +%FT%TZ)
  branches=$(gh api "repos/$CALIBRATION_REPO/branches" --paginate --jq '.[].name' | grep -E '^cit-[0-9]+-' || true)
  for b in $branches; do
    [ "$(gh pr list --repo "$CALIBRATION_REPO" --head "$b" --state all --json number --jq length)" = 0 ] || continue
    read -r ahead when subject < <(gh api "repos/$CALIBRATION_REPO/compare/$CALIBRATION_BASE...$b" \
      --jq '"\(.ahead_by) \(.commits[-1].commit.committer.date // "none") \(.commits[-1].commit.message // "" | split("\n")[0])"') ||
      { echo "supervisor: WARNING could not compare $b with $CALIBRATION_BASE" >&2; continue; }
    [ "$ahead" -gt 0 ] && [[ "$when" > "$since" ]] || continue
    id=$(printf '%s' "$b" | sed -E 's/^cit-([0-9]+)-.*/CIT-\1/')
    if url=$(gh pr create --repo "$CALIBRATION_REPO" --base "$CALIBRATION_BASE" --head "$b" \
      --title "$id: $subject" \
      --body "Shipped by \`agent_ship\` for $id, and opened by the supervisor so it gets reviewed. Nothing merges it on its own."); then
      echo "supervisor: opened $url for the shipped branch $b"
    else
      echo "supervisor: WARNING could not open a PR for the shipped branch $b" >&2
    fi
  done
fi
wf=$repo/$WORKFLOW_PATH
[ -d "$wf" ] ||
  { echo "supervisor: $CALIBRATION_BASE has no $WORKFLOW_PATH to calibrate" >&2; exit 1; }
(cd "$wf" && npm ci --no-audit --no-fund && npm run build) > "$CAL_DIR/build.log" 2>&1 ||
  { cat "$CAL_DIR/build.log" >&2; echo "supervisor: the workflow did not build" >&2; exit 1; }

echo "supervisor: starting the local task server"
(cd "$wf" && exec render workflows dev -- npm start) > "$CAL_DIR/dev.log" 2>&1 &
dev_pid=$!
# Up when anything answers on the port; a server that exits first, or
# never answers, is a failed calibration rather than an empty plan.
ready=0
for _ in $(seq 1 "${CALIBRATION_DEV_WAIT:-60}"); do
  kill -0 "$dev_pid" 2> /dev/null || break
  if curl -s -o /dev/null --max-time 2 "$RENDER_LOCAL_DEV_URL/"; then
    ready=1
    break
  fi
  sleep 1
done
[ "$ready" -eq 1 ] || {
  cat "$CAL_DIR/dev.log" >&2
  echo "supervisor: the local task server never came up on $RENDER_LOCAL_DEV_URL" >&2
  exit 1
}

if [ -n "$apply_run" ]; then
  echo "supervisor: waiting for apply run $apply_run before planning"
  apply_changeset wait "$apply_run" ||
    echo "supervisor: apply run $apply_run did not go through; the next run starts it again" >&2
fi

echo "supervisor: running the plan task on the local task server"
# Deliberately unquoted: each delivery is its own argument.
# shellcheck disable=SC2086
plan=$(cd "$wf" && node dist/calibrate.js plan "${CALIBRATION_TEAM:-CIT}" ${CALIBRATION_DELIVERIES:-CIT-439}) &&
  printf '%s' "$plan" | jq -e '(.order | type == "array") and (.seen | type == "object")' > /dev/null ||
  { echo "supervisor: the plan task produced no plan" >&2; exit 1; }
printf '%s\n' "$plan" | jq . > "$CAL_DIR/plan.json"

# The prompt, with the frozen plan in place of {{PLAN}}. `seen` is left
# out: the run fills it in, and it is long.
# The prompt is main's, so a merged prompt change takes effect on the next
# run without a new image; the image's copy is the fallback.
jq 'del(.seen)' "$CAL_DIR/plan.json" > "$CAL_DIR/plan-for-prompt.json"
prompt_file="$repo/${WORKFLOW_PATH%/workflow}/supervisor/prompt.md"
[ -f "$prompt_file" ] || prompt_file="$DIR/prompt.md"
# The session cannot read GitHub, so the recent pull requests go in the
# prompt: what merged is the evidence a `done` or a `review` rests on.
gh pr list --repo "$CALIBRATION_REPO" --state all --limit 40 \
  --json number,title,state,isDraft,mergedAt,headRefName > "$CAL_DIR/pulls.raw" 2> /dev/null || true
jq -c '[.[] | select(.headRefName != "'"$CALIBRATION_BRANCH"'")]' "$CAL_DIR/pulls.raw" > "$CAL_DIR/pulls.json" 2> /dev/null ||
  echo '[]' > "$CAL_DIR/pulls.json"
prompt=$(sed -e "s|{{NOW}}|$now|g" "$prompt_file" |
  awk -v plan="$CAL_DIR/plan-for-prompt.json" -v pulls="$CAL_DIR/pulls.json" \
    '$0 == "{{PLAN}}" { while ((getline l < plan) > 0) print l; next }
     $0 == "{{PULLS}}" { while ((getline l < pulls) > 0) print l; next } { print }')

# 3. The hourly run continues the one session, with Remote Control so it
# can be driven from the Claude app between runs. A one-off calibration is
# fresh, cheap and not talked to, and runs from its scratch directory so no
# session is filed under the hourly run's directory. The prompt stays
# directly after -p and the variadic tool lists come last, or
# --allowedTools would swallow it.
if [ "$MODE" = tick ]; then
  claude_timeout=${SUPERVISOR_CLAUDE_TIMEOUT:-30m}
  model=${SUPERVISOR_MODEL:-sonnet} effort=${SUPERVISOR_EFFORT:-medium}
  session=(--continue --remote-control) claude_dir=$SESSION_DIR
else
  claude_timeout=${CALIBRATION_CLAUDE_TIMEOUT:-20m}
  model=${CALIBRATION_MODEL:-haiku} effort=${CALIBRATION_EFFORT:-low}
  session=() claude_dir=$CAL_DIR
fi
# One run of the session: sets $out and $body, the changeset's pkl body.
# $1 is added to the prompt.
plan_once() {
  claude_rc=0
  # Deliberately unquoted: each tool name is its own argument.
  # shellcheck disable=SC2086
  out=$(cd "$claude_dir" && timeout --signal=TERM --kill-after=30s "$claude_timeout" \
    claude "${session[@]}" -p "$prompt$1" \
      --model "$model" \
      --effort "$effort" \
      --mcp-config "$MCP_FILE" --strict-mcp-config \
      --allowedTools $ALLOWED_TOOLS \
      --disallowedTools $DISALLOWED_TOOLS) || claude_rc=$?
  printf '%s\n' "$out"
  check_claude

  # The changeset's body is the fenced pkl block after the marker line, and
  # nothing else the model said.
  body=$(printf '%s\n' "$out" | awk '
    /^SUPERVISOR_CHANGESET:/ { marked = 1; inblock = 0; body = ""; next }
    marked && !inblock && /^```pkl[[:space:]]*$/ { inblock = 1; next }
    inblock && /^```[[:space:]]*$/ { done = 1; inblock = 0; marked = 0; next }
    inblock { body = body $0 "\n" }
    END { if (done) printf "%s", body; else exit 1 }') || {
    echo "supervisor: no SUPERVISOR_CHANGESET line followed by a pkl block" >&2
    exit 1
  }
}

# Render it twice: first with every open issue as `seen`, which checks the
# schema and yields the issues it touches; then with `seen` cut down to
# those, which is what gets committed.
write_changeset() { # $1: a JSON object of identifier -> updatedAt
  {
    # No timestamp: an unchanged plan must render to an unchanged file.
    echo "// Planning's changeset (CIT-472), written by calibration against"
    echo "// $CALIBRATION_BASE@$base_sha. Merging it is applying it; render with"
    echo "// \`pkl eval -f json -o changeset.json changeset.pkl\`."
    echo 'amends "pkl/Changeset.pkl"'
    echo
    printf '%s\n' "$1" | jq -r '"seen {", (to_entries[] | "  [\(.key | @json)] = \(.value | @json)"), "}"'
    echo
    printf '%s' "$body"
  } > "$wf/changeset.pkl"
  (cd "$wf" && pkl eval -f json -o changeset.json changeset.pkl) 2> "$CAL_DIR/pkl.log" || {
    cat "$CAL_DIR/pkl.log" >&2
    echo "supervisor: the changeset does not render through pkl/Changeset.pkl" >&2
    return 1
  }
}

echo "supervisor: running the session ($model, $effort), read-only"
plan_once ""
# A changeset that does not render goes back to the session once, with the
# error, rather than costing the run its changeset.
if ! write_changeset "$(jq -c .seen "$CAL_DIR/plan.json")"; then
  echo "supervisor: asking again, with the render error"
  plan_once "$(printf '\n\n## Your last changeset did not render\n\nFix this and give your whole answer again, ending with the changeset:\n\n```\n%s\n```\n' "$(cat "$CAL_DIR/pkl.log")")"
  write_changeset "$(jq -c .seen "$CAL_DIR/plan.json")" || exit 1
fi
touched=$(jq -c '[.clusters[] | .key, .issues[]] + [(.decline, .duplicate, .escalate, .delegate)[] | .issue]
  | map(select(startswith("new:") | not)) | unique' "$wf/changeset.json")
write_changeset "$(jq -c --argjson t "$touched" '.seen | with_entries(select(.key as $k | $t | index($k)))' "$CAL_DIR/plan.json")" || exit 1

# The test: apply, dry, on the dev server, against the tree the PR will
# carry. It reads changeset.json afresh on every call.
echo "supervisor: dry-running apply on the local task server"
dry=$(cd "$wf" && node dist/calibrate.js apply "${CALIBRATION_TEAM:-CIT}") ||
  { echo "supervisor: the changeset's dry run failed" >&2; exit 1; }
printf '%s\n' "$dry" | jq . > "$CAL_DIR/dry-run.json"

# A plan the base already carries proposes nothing: no PR, nothing to
# merge. Otherwise every merge would leave the next tick a fresh base, and
# the same plan would be proposed and merged again each hour.
if git -C "$repo" show "HEAD:$WORKFLOW_PATH/changeset.json" 2> /dev/null | cmp -s - "$wf/changeset.json"; then
  echo "supervisor: the plan matches $CALIBRATION_BASE; nothing to propose"
  jq -r '"SUPERVISOR_CHANGESET: ops=\(.applied | length) clusters=\(.clusters | length)"' "$CAL_DIR/dry-run.json"
  echo "SUPERVISOR_PLAN: unchanged"
  exit 0
fi

# Green: the changeset is the PR. An unchanged changeset on an unchanged
# base is no change at all, and the PR is left alone.
same_as_branch() { # $1: a path under the workflow
  git -C "$repo" show "FETCH_HEAD:$WORKFLOW_PATH/$1" 2> /dev/null | cmp -s - "$wf/$1"
}
if git -C "$repo" fetch --quiet --depth 2 origin "$CALIBRATION_BRANCH" 2> /dev/null &&
  [ "$(git -C "$repo" rev-parse FETCH_HEAD~1 2> /dev/null)" = "$base_sha" ] &&
  same_as_branch changeset.pkl && same_as_branch changeset.json; then
  echo "supervisor: the changeset is unchanged on $CALIBRATION_BRANCH"
else
  # The branch is calibration's own: one commit on top of the base, so it
  # is replaced each time rather than piling up.
  git -C "$repo" checkout --quiet -B "$CALIBRATION_BRANCH"
  git -C "$repo" add "$WORKFLOW_PATH/changeset.pkl" "$WORKFLOW_PATH/changeset.json"
  git -C "$repo" commit --quiet -m "supervisor: changeset ($now)" \
    -m "Dry-run on the local task server. Merging this applies it."
  git -C "$repo" push --quiet --force origin "$CALIBRATION_BRANCH" ||
    { echo "supervisor: could not push $CALIBRATION_BRANCH" >&2; exit 1; }
  echo "supervisor: pushed the changeset to $CALIBRATION_BRANCH"
fi

pr=$(gh pr list --repo "$CALIBRATION_REPO" --head "$CALIBRATION_BRANCH" --base "$CALIBRATION_BASE" \
  --state open --json url --jq '.[0].url // empty') ||
  { echo "supervisor: could not list the calibration PRs" >&2; exit 1; }
# The body is the dry run's op table, so it is rewritten on every run: an
# open PR's body must describe the changeset now on its branch.
jq -r --arg model "$model" --arg effort "$effort" --arg base "$base_sha" \
  '"The supervisor'"'"'s changeset (CIT-472), written with \($model) at \($effort) effort against `\($base)`, and dry-run on the local task server.",
  "",
  "**Merging this applies it.** Nothing has been written to Linear yet.",
  "",
  "| op | target | detail |",
  "| --- | --- | --- |",
  (.applied[] | "| \(.op) | \(.target) | \(.detail | gsub("[|]"; "/")) |")' \
  "$CAL_DIR/dry-run.json" > "$CAL_DIR/body.md"
if [ -z "$pr" ]; then
  pr=$(gh pr create --repo "$CALIBRATION_REPO" --base "$CALIBRATION_BASE" --head "$CALIBRATION_BRANCH" \
    --title "Supervisor changeset" --body-file "$CAL_DIR/body.md") ||
    { echo "supervisor: could not open the changeset PR" >&2; exit 1; }
else
  gh pr edit "$pr" --repo "$CALIBRATION_REPO" --body-file "$CAL_DIR/body.md" > /dev/null ||
    { echo "supervisor: could not update the changeset PR" >&2; exit 1; }
fi
echo "supervisor: changeset PR $pr"
jq -r '"SUPERVISOR_CHANGESET: ops=\(.applied | length) clusters=\(.clusters | length)"' "$CAL_DIR/dry-run.json"
# The hourly run merges its own; a one-off calibration only proposes.
merge_default=0
[ "$MODE" = calibrate ] || merge_default=1
if [ "${CALIBRATION_MERGE:-$merge_default}" != 1 ]; then
  echo "SUPERVISOR_PLAN: proposed pr=$pr"
  exit 0
fi

# Merge on green: auto-merge, only for the head pushed here. Nothing waits
# for the checks; the next run applies whatever merged.
head=$(gh pr view "$pr" --repo "$CALIBRATION_REPO" --json headRefOid --jq .headRefOid) ||
  { echo "supervisor: could not read the changeset PR's head" >&2; exit 1; }
gh pr merge "$pr" --repo "$CALIBRATION_REPO" --auto --squash --match-head-commit "$head" ||
  { echo "supervisor: could not turn on auto-merge for the changeset PR $pr" >&2; exit 1; }
echo "SUPERVISOR_PLAN: auto-merge pr=$pr"
exit 0
