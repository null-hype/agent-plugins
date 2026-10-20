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

: "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:?PROTON_PASS_PERSONAL_ACCESS_TOKEN must be set}"
: "${TOOLBOX_TOKEN:?TOOLBOX_TOKEN must be set: copy it from the env vars of the toolbox Render service}"
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
  export PROTON_PASS_AGENT_REASON="supervisor: resolve the Claude Code token, Linear key and restic secrets for an hourly tick"

  echo "supervisor: checking Proton Pass session"
  if ! timeout --foreground --kill-after=10s 60s pass-cli info > /dev/null 2>&1; then
    timeout --foreground --kill-after=10s 60s pass-cli logout --force > /dev/null 2>&1 || true
    echo "supervisor: logging in to Proton Pass"
    timeout --foreground --kill-after=10s 2m pass-cli login
  fi

  # Only pass:// references are in this file; the values are resolved by
  # pass-cli run and never touch disk.
  pass-cli run --env-file "$DIR/supervisor.env" -- bash "$0" --resolved
  exit $?
fi

# --resolved: the secrets are in the environment from here on.
: "${CLAUDE_CODE_OAUTH_TOKEN:?CLAUDE_CODE_OAUTH_TOKEN must come from the pass env file}"
: "${LINEAR_API_KEY:?LINEAR_API_KEY must come from the pass env file}"
: "${GCP_SERVICE_ACCOUNT_KEY:?GCP_SERVICE_ACCOUNT_KEY must come from the pass env file (restic)}"
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY must come from the pass env file}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD must come from the pass env file}"

# The toolbox's read-only tools, and the Linear server as a whole: the session
# works the dispatch issues, so it reads them and comments on them. Every
# toolbox tool that starts, stops, deletes or dispatches is spelled out as
# disallowed as well, so an allowlist that ever fails open still cannot move
# any infrastructure. Bash and the file-editing tools are disallowed for the
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

MCP_FILE=$(mktemp)
GCS_KEY_FILE=$(mktemp)
trap 'rm -f "$MCP_FILE" "$GCS_KEY_FILE"' EXIT
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

# The GCS backend wants GOOGLE_APPLICATION_CREDENTIALS to point at a key
# file, not the inline JSON pass-cli resolves.
printf %s "$GCP_SERVICE_ACCOUNT_KEY" > "$GCS_KEY_FILE"
export GOOGLE_APPLICATION_CREDENTIALS=$GCS_KEY_FILE

prompt=$(sed -e "s|{{NOW}}|$(date -u +%FT%TZ)|g" "$DIR/prompt.md")

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
claude_rc=0
# Deliberately unquoted: each tool name is its own argument.
# shellcheck disable=SC2086
out=$(cd "$SESSION_DIR" && timeout --signal=TERM --kill-after=30s "${SUPERVISOR_CLAUDE_TIMEOUT:-30m}" \
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

failed=0
# 124 is timeout's TERM, 137 its KILL after the grace period.
case "$claude_rc" in
  0) ;;
  124 | 137)
    echo "supervisor: claude timed out after ${SUPERVISOR_CLAUDE_TIMEOUT:-30m} -- this tick has no decision" >&2
    failed=1
    ;;
  *)
    echo "supervisor: claude exited $claude_rc -- this tick has no decision" >&2
    failed=1
    ;;
esac
if [ "$backup_rc" -ne 0 ]; then
  echo "supervisor: restic backup exited $backup_rc -- the next tick will continue from an older transcript" >&2
  failed=1
fi
[ "$failed" -eq 0 ] || exit 1

# A run that produced prose but never reached a decision is a broken
# instrument, not a tick with nothing to do.
heartbeat=$(printf '%s\n' "$out" | grep -E '^SUPERVISOR_HEARTBEAT: ' | tail -1 || true)
case "$heartbeat" in
  *decision=*) echo "$heartbeat" ;;
  *)
    echo "supervisor: no SUPERVISOR_HEARTBEAT line carrying a decision" >&2
    exit 1
    ;;
esac
