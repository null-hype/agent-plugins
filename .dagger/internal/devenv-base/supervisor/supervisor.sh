#!/usr/bin/env bash
# One hourly supervisor tick (CIT-443, CIT-451, CIT-453).
#
# The supervisor is one Claude session that lives across ticks. Each tick does
# what `color resume` does on a codespace start, on Render's schedule instead:
#
#   1. restore  ~/.claude from the newest restic snapshot tagged `supervisor`;
#   2. continue the session in /workspaces/agent-plugins, in the foreground,
#               under a wall-clock timeout;
#   3. back up  ~/.claude, whether or not claude succeeded, so the next tick
#               remembers a failure rather than starting from before it.
#
# `claude --continue`, not `--resume <id>`: there is one session, so there is
# no id to keep. Claude files sessions by working directory and --continue
# picks the newest one in the current directory, which is why the tick always
# runs from the directory the seed was made in.
#
# The continue is a foreground `claude -p`, not `--bg`: the Render container
# ends when this command exits, and a backgrounded session would die with it.
#
# The session still cannot move infrastructure. It holds the toolbox's
# read-only tools plus the Linear tools (it works the dispatch issues), every
# toolbox tool that starts, stops, deletes or dispatches is named in
# --disallowedTools, and --strict-mcp-config keeps any other MCP server
# configured in the image from joining in.
#
# The last line of a successful run is a heartbeat, and its absence is what
# separates a quiet failure from a quiet success: a job that dies early reaps
# nothing and reports nothing, which otherwise looks exactly like a tick
# where there was nothing to do. Silence is never success.
#
# One Render service, so Render's single-run guarantee means a tick still
# running when the next is due delays that next one. SUPERVISOR_TIMEOUT stays
# below the hour for that reason: one tick must not delay the next.
#
# SUPERVISOR_MODE=calibrate (CIT-472) runs a calibration instead: the
# planning hat, fresh and read-only, whose output is a changeset of agentic
# work, dry-run on the workflow's dev server and opened as a pull request.
# Merging it is applying it; nothing here deploys or writes to Linear. See
# the calibration block below and README.md.
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
    export PROTON_PASS_AGENT_REASON="supervisor: resolve the Claude Code token, Linear key, toolbox token and restic secrets for an hourly tick"
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
if [ "$MODE" = calibrate ]; then
  : "${GITHUB_TOKEN:?GITHUB_TOKEN must come from the pass env file (the calibration PR)}"
else
  : "${GCP_SERVICE_ACCOUNT_KEY:?GCP_SERVICE_ACCOUNT_KEY must come from the pass env file (restic)}"
  : "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY must come from the pass env file}"
  : "${RESTIC_PASSWORD:?RESTIC_PASSWORD must come from the pass env file}"
fi

# The toolbox's read-only tools, and the Linear server as a whole: the session
# works the dispatch issues, so it reads them, comments, files handoffs and
# clears Triage. Every toolbox tool that starts, stops, deletes or dispatches
# is spelled out as disallowed as well, so an allowlist that ever fails open
# still cannot move any infrastructure. Bash and the file-editing tools are disallowed for the
# same reason: with Bash the model could reach the toolbox over curl and route
# around this list entirely.
ALLOWED_TOOLS="mcp__toolbox__ping
mcp__toolbox__host_status
mcp__toolbox__workspace_list
mcp__toolbox__workspace_status
mcp__toolbox__codespace_status
mcp__toolbox__codex_review_status
mcp__linear"
DISALLOWED_TOOLS="mcp__toolbox__host_start
mcp__toolbox__host_stop
mcp__toolbox__agent_start
mcp__toolbox__workspace_up
mcp__toolbox__workspace_stop
mcp__toolbox__workspace_delete
mcp__toolbox__codespace_start
mcp__toolbox__codespace_stop
mcp__toolbox__codespace_rebuild
mcp__toolbox__codex_review
Bash
Write
Edit
NotebookEdit
WebFetch
Task"

# A calibration is plan-only, so Linear is not allowed as a whole: only the
# tools that read it are. Every Linear tool that writes is disallowed by name
# as well, on top of the tick's list, so a plan-only run cannot write to
# Linear even if the allowlist ever failed open. Its writes go into the
# changeset instead, which merging applies.
if [ "$MODE" = calibrate ]; then
  ALLOWED_TOOLS="$(printf '%s\n' "$ALLOWED_TOOLS" | grep -vx mcp__linear)
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
  DISALLOWED_TOOLS="$DISALLOWED_TOOLS
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
mcp__linear__update_diff"
fi

MCP_FILE=$(mktemp)
GCS_KEY_FILE=$(mktemp)
# Calibration's scratch: the clone of the repo and the dev server's pid.
CAL_DIR=""
dev_pid=""
cleanup() {
  if [ -n "$dev_pid" ]; then
    kill "$dev_pid" 2> /dev/null || true
    wait "$dev_pid" 2> /dev/null || true
  fi
  rm -f "$MCP_FILE" "$GCS_KEY_FILE"
  [ -z "$CAL_DIR" ] || rm -rf "$CAL_DIR"
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

# claude's exit, the first check every run ends with. $1 is the backup's
# exit status, which only a tick has.
check_claude() {
  local backup_rc=${1:-0} failed=0
  # 124 is timeout's TERM, 137 its KILL after the grace period.
  case "$claude_rc" in
    0) ;;
    124 | 137)
      echo "supervisor: claude timed out after $claude_timeout -- this $MODE has no decision" >&2
      failed=1
      ;;
    *)
      echo "supervisor: claude exited $claude_rc -- this $MODE has no decision" >&2
      failed=1
      ;;
  esac
  if [ "$backup_rc" -ne 0 ]; then
    echo "supervisor: restic backup exited $backup_rc -- the next tick will continue from an older transcript" >&2
    failed=1
  fi
  [ "$failed" -eq 0 ] || exit 1
}

if [ "$MODE" = calibrate ]; then
  # --- calibration (CIT-472) -------------------------------------------------
  #
  # Calibration is the planning hat, and its output is a changeset: a PR
  # that, merged, is applied by the deployed workflow. Merging is applying.
  # Driven by bash, not the model:
  #
  #   1. clone the repo at CALIBRATION_BASE and build the workflow there;
  #   2. start the local task server, `render workflows dev -- npm start`, and
  #      run the read-only `plan` task on it through the SDK's local mode;
  #   3. run planning once, fresh, with a small model at low effort: it reads
  #      Linear, never writes it, and ends with the changeset's Pkl body;
  #   4. render it through workflow/pkl/Changeset.pkl, which refuses a
  #      changeset that does not type-check or whose references do not
  #      resolve, with `seen` filled in from the plan, not by the model;
  #   5. dry-run the `apply` task on the dev server against that very tree:
  #      the test. A changeset that would not apply as written fails here;
  #   6. if all of that is green, commit changeset.pkl and changeset.json on
  #      CALIBRATION_BRANCH and open (or update) one PR into CALIBRATION_BASE.
  #
  # Nothing here deploys or writes to Linear: the dev server only simulates
  # Render, nothing calls Render's API, and apply only ever runs dry.
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
  echo "supervisor: calibrating against $CALIBRATION_REPO@$CALIBRATION_BASE"
  git -c credential.helper= -c 'credential.helper=!gh auth git-credential' \
    clone --quiet --depth 1 --branch "$CALIBRATION_BASE" "$CALIBRATION_REMOTE" "$repo" ||
    { echo "supervisor: could not clone $CALIBRATION_BASE" >&2; exit 1; }
  git -C "$repo" config credential.helper '!gh auth git-credential'
  base_sha=$(git -C "$repo" rev-parse HEAD)
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

  echo "supervisor: running the plan task on the local task server"
  # Deliberately unquoted: each delivery is its own argument.
  # shellcheck disable=SC2086
  plan=$(cd "$wf" && node dist/calibrate.js plan "${CALIBRATION_TEAM:-CIT}" ${CALIBRATION_DELIVERIES:-CIT-439}) &&
    printf '%s' "$plan" | jq -e '(.order | type == "array") and (.seen | type == "object")' > /dev/null ||
    { echo "supervisor: the plan task produced no plan" >&2; exit 1; }
  printf '%s\n' "$plan" | jq . > "$CAL_DIR/plan.json"

  # Planning's prompt, with the frozen plan in place of {{PLAN}}. `seen` is
  # left out: the run fills it in, and it is long.
  jq 'del(.seen)' "$CAL_DIR/plan.json" > "$CAL_DIR/plan-for-prompt.json"
  prompt=$(sed -e "s|{{NOW}}|$now|g" "$DIR/planning.md" |
    awk -v plan="$CAL_DIR/plan-for-prompt.json" \
      '$0 == "{{PLAN}}" { while ((getline l < plan) > 0) print l; next } { print }')

  # Fresh, small and cheap: no --continue and no Remote Control, because a
  # calibration remembers nothing and is not talked to. It runs from its
  # scratch directory so no session is filed under the tick's directory.
  claude_timeout=${CALIBRATION_CLAUDE_TIMEOUT:-20m}
  echo "supervisor: planning, read-only"
  claude_rc=0
  # shellcheck disable=SC2086
  out=$(cd "$CAL_DIR" && timeout --signal=TERM --kill-after=30s "$claude_timeout" \
    claude -p "$prompt" \
      --model "${CALIBRATION_MODEL:-haiku}" \
      --effort "${CALIBRATION_EFFORT:-low}" \
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
      exit 1
    }
  }
  write_changeset "$(jq -c .seen "$CAL_DIR/plan.json")"
  touched=$(jq -c '[.clusters[] | .key, .issues[]] + [(.decline, .duplicate, .escalate, .delegate)[] | .issue]
    | map(select(startswith("new:") | not)) | unique' "$wf/changeset.json")
  write_changeset "$(jq -c --argjson t "$touched" '.seen | with_entries(select(.key as $k | $t | index($k)))' "$CAL_DIR/plan.json")"

  # The test: apply, dry, on the dev server, against the tree the PR will
  # carry. It reads changeset.json afresh on every call.
  echo "supervisor: dry-running apply on the local task server"
  dry=$(cd "$wf" && node dist/calibrate.js apply "${CALIBRATION_TEAM:-CIT}") ||
    { echo "supervisor: the changeset's dry run failed" >&2; exit 1; }
  printf '%s\n' "$dry" | jq . > "$CAL_DIR/dry-run.json"

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
    git -C "$repo" commit --quiet -m "supervisor calibration: planning's changeset ($now)" \
      -m "Planned and dry-run on the local task server. Merging this applies it."
    git -C "$repo" push --quiet --force origin "$CALIBRATION_BRANCH" ||
      { echo "supervisor: could not push $CALIBRATION_BRANCH" >&2; exit 1; }
    echo "supervisor: pushed the changeset to $CALIBRATION_BRANCH"
  fi

  pr=$(gh pr list --repo "$CALIBRATION_REPO" --head "$CALIBRATION_BRANCH" --base "$CALIBRATION_BASE" \
    --state open --json url --jq '.[0].url // empty') ||
    { echo "supervisor: could not list the calibration PRs" >&2; exit 1; }
  # The body is the dry run's op table, so it is rewritten on every run: an
  # open PR's body must describe the changeset now on its branch.
  jq -r --arg model "${CALIBRATION_MODEL:-haiku}" --arg effort "${CALIBRATION_EFFORT:-low}" --arg base "$base_sha" \
    '"The changeset from planning (CIT-472), planned with \($model) at \($effort) effort against `\($base)`, and dry-run on the local task server.",
    "",
    "**Merging this applies it.** Nothing has been written to Linear yet.",
    "",
    "| op | target | detail |",
    "| --- | --- | --- |",
    (.applied[] | "| \(.op) | \(.target) | \(.detail | gsub("[|]"; "/")) |")' \
    "$CAL_DIR/dry-run.json" > "$CAL_DIR/body.md"
  if [ -z "$pr" ]; then
    pr=$(gh pr create --repo "$CALIBRATION_REPO" --base "$CALIBRATION_BASE" --head "$CALIBRATION_BRANCH" \
      --title "Supervisor calibration: planning's changeset" --body-file "$CAL_DIR/body.md") ||
      { echo "supervisor: could not open the calibration PR" >&2; exit 1; }
  else
    gh pr edit "$pr" --repo "$CALIBRATION_REPO" --body-file "$CAL_DIR/body.md" > /dev/null ||
      { echo "supervisor: could not update the calibration PR" >&2; exit 1; }
  fi
  echo "supervisor: calibration PR $pr"
  jq -r '"SUPERVISOR_CHANGESET: ops=\(.applied | length) clusters=\(.clusters | length)"' "$CAL_DIR/dry-run.json"
  exit 0
fi

# --- the tick ----------------------------------------------------------------

# The checks a tick ends with, after claude's exit: the heartbeat, then a
# pass line per hat. Sets $heartbeat; exits on failure.
check_passes() {
  local hats
  # A run that produced prose but never reached a decision is a broken
  # instrument, not a tick with nothing to do.
  heartbeat=$(printf '%s\n' "$out" | grep -E '^SUPERVISOR_HEARTBEAT: ' | tail -1 || true)
  case "$heartbeat" in
    *decision=*) ;;
    *)
      echo "supervisor: no SUPERVISOR_HEARTBEAT line carrying a decision" >&2
      exit 1
      ;;
  esac
  # Each hat's pass says what it handed off, in order. The handoffs are the
  # only memory the next pass reads, so a pass that never reported one is as
  # silent as a missing heartbeat.
  hats=$(printf '%s\n' "$out" |
    sed -nE 's/^SUPERVISOR_PASS: hat=([a-z-]+) handoffs=[^ ]+ why=.*/\1/p' | paste -sd' ')
  [ "$hats" = "planning infra open-source" ] || {
    echo "supervisor: expected SUPERVISOR_PASS lines for planning, infra and open-source in that order, got: ${hats:-none}" >&2
    exit 1
  }
}

prompt=$(sed -e "s|{{NOW}}|$now|g" "$DIR/prompt.md")

# The GCS backend wants GOOGLE_APPLICATION_CREDENTIALS to point at a key
# file, not the inline JSON pass-cli resolves.
printf %s "$GCP_SERVICE_ACCOUNT_KEY" > "$GCS_KEY_FILE"
export GOOGLE_APPLICATION_CREDENTIALS=$GCS_KEY_FILE

# 1. Restore the newest snapshot under the tag. Every tick backs up the whole
# of ~/.claude, so the newest one is the session as the last tick left it. No
# snapshot is a failed run -- continuing nothing would quietly start a
# different, amnesiac session.
echo "supervisor: restoring the newest snapshot tagged $RESTIC_TAG"
snap=$(restic snapshots --json --tag "$RESTIC_TAG" |
  jq -r '(. // []) | max_by(.time) | (.id // empty)') ||
  { echo "supervisor: restic snapshots failed" >&2; exit 1; }
[ -n "$snap" ] || {
  echo "supervisor: no snapshot tagged $RESTIC_TAG" >&2
  exit 1
}
# Leave out the runtime state of the background daemon: its lock names a pid
# from the old machine, and stale job records make claude think the session
# is still running.
restic restore "$snap" --target "$HOME" \
  --exclude "/.claude/daemon*" --exclude /.claude/jobs
# ~/.claude.json (workspace trust, the account) lives outside ~/.claude, but
# Claude keeps copies of it inside.
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

# 2. Continue, in the foreground. The prompt stays directly after -p and the
# variadic tool lists come last, or --allowedTools would swallow it.
# --remote-control registers the session with the account so it can be
# driven from the Claude app between ticks.
mkdir -p "$SESSION_DIR"
echo "supervisor: continuing the session in $SESSION_DIR"
claude_timeout=${SUPERVISOR_CLAUDE_TIMEOUT:-30m}
claude_rc=0
# Deliberately unquoted: each tool name is its own argument.
# shellcheck disable=SC2086
out=$(cd "$SESSION_DIR" && timeout --signal=TERM --kill-after=30s "$claude_timeout" \
  claude --continue --remote-control -p "$prompt" \
    --model "${SUPERVISOR_MODEL:-sonnet}" \
    --effort "${SUPERVISOR_EFFORT:-low}" \
    --mcp-config "$MCP_FILE" --strict-mcp-config \
    --allowedTools $ALLOWED_TOOLS \
    --disallowedTools $DISALLOWED_TOOLS) || claude_rc=$?
printf '%s\n' "$out"

# 3. Back up, whatever claude did. From $HOME with a relative path, so the
# snapshot holds /.claude/... and restores with the --target and --exclude
# above; `restic backup ~/.claude` would store /root/.claude/... and restore
# one level too deep, with the excludes matching nothing.
echo "supervisor: backing up the session to restic tag $RESTIC_TAG"
backup_rc=0
(cd "$HOME" && restic backup .claude --tag "$RESTIC_TAG") || backup_rc=$?

check_claude "$backup_rc"
check_passes
echo "$heartbeat"
