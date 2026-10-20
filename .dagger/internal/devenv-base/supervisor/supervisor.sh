#!/usr/bin/env bash
# One dispatch window's supervisor run, for one zone (CIT-443, CIT-451).
#
# The zone's supervisor is a Claude session that lives across runs. Each run
# does what `color resume` does on a codespace start, on the zone's Render
# schedule instead:
#
#   1. restore  the zone's session transcript from restic;
#   2. resume   it in the foreground, under a wall-clock timeout;
#   3. back up  the transcript, whether or not claude succeeded, so the next
#               run remembers a failure rather than starting from before it.
#
# The resume is a foreground `claude -p`, not `--bg`: the Render container
# ends when this command exits, and a backgrounded session would die with it.
#
# The session still cannot move infrastructure. It holds the toolbox's
# read-only tools plus the Linear tools (it works a Linear issue), every
# toolbox tool that starts, stops, deletes or dispatches is named in
# --disallowedTools, and --strict-mcp-config keeps any other MCP server
# configured in the image from joining in.
#
# The last line of a successful run is a heartbeat, and its absence is what
# separates a quiet failure from a quiet success: a job that dies early reaps
# nothing and reports nothing, which otherwise looks exactly like a window
# where there was nothing to do. Silence is never success.
#
# One zone per service, parameterised by SUPERVISOR_ZONE, the same way
# keepalive/devpod-keepalive.sh is parameterised by WORKSPACE_ID. Render's
# single-run guarantee is per service, so the job that reaps a stuck window
# is never the job that is stuck -- and each zone has its own transcript,
# because the guarantee does not hold across services.
#
# Usage: supervisor.sh                (from Render: the image entrypoint)
#        supervisor.sh --bounded-run  (itself, re-executed under the timeout)
#        supervisor.sh --resolved     (itself, re-executed under pass-cli run)
set -euo pipefail

# Bound the whole run, the Proton Pass login included: a login left
# unbounded can hang the job (observed for the keepalive on 2026-09-06), and
# the single-run guarantee turns a hung run into a *missed* next window
# rather than an overlapping one. It must outlast SUPERVISOR_CLAUDE_TIMEOUT
# with room for the restore before and the backup after, or a timed-out claude
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
ZONE="${SUPERVISOR_ZONE:?SUPERVISOR_ZONE must be set: one Render cron service per zone}"
ZONE_TZ="${SUPERVISOR_TZ:?SUPERVISOR_TZ must be set: the IANA timezone of the team, e.g. Europe/Berlin}"
TOOLBOX_URL=${TOOLBOX_URL:-https://toolbox-spike.onrender.com/mcp}
LINEAR_MCP_URL=${LINEAR_MCP_URL:-https://mcp.linear.app/mcp}
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Every run of a zone backs up under, and restores from, this one tag.
RESTIC_TAG="supervisor-$ZONE"

# The zone names the pass item that holds its session id, so it has to be a
# plain slug: it is also interpolated into a pass:// reference and a restic
# tag.
case "$ZONE" in
  '' | *[!a-z0-9-]*)
    echo "supervisor ($ZONE): SUPERVISOR_ZONE must be lowercase letters, digits and hyphens" >&2
    exit 1
    ;;
esac

# An unknown TZ makes GNU date fall back to UTC without a word, which would
# put the window hours off and look like a working run. Refuse instead.
[ -f "/usr/share/zoneinfo/$ZONE_TZ" ] ||
  { echo "supervisor ($ZONE): unknown timezone $ZONE_TZ" >&2; exit 1; }

# Render schedules in UTC, and a zone's midnight moves against UTC twice a
# year. So the cron is only a sampler: the local clock here is what decides
# whether a window is near, which is why each DST-observing zone's schedule
# fires at both candidate hours and one of the two runs decides "not yet".
# The model is given these numbers rather than asked to do timezone
# arithmetic.
local_now=$(TZ="$ZONE_TZ" date +'%F %T %Z')
to_midnight=$(( ( $(TZ="$ZONE_TZ" date -d 'tomorrow 00:00' +%s) - $(date +%s) ) / 60 ))
since_midnight=$(( ( $(date +%s) - $(TZ="$ZONE_TZ" date -d 'today 00:00' +%s) ) / 60 ))

export PROTON_PASS_KEY_PROVIDER=${PROTON_PASS_KEY_PROVIDER:-fs}

if [ "$stage" = --bounded-run ]; then
  export PROTON_PASS_AGENT_REASON="supervisor ($ZONE): resolve the Claude Code token, Linear key, restic secrets and this zone's session id for a dispatch window"

  echo "supervisor ($ZONE): checking Proton Pass session"
  if ! timeout --foreground --kill-after=10s 60s pass-cli info > /dev/null 2>&1; then
    timeout --foreground --kill-after=10s 60s pass-cli logout --force > /dev/null 2>&1 || true
    echo "supervisor ($ZONE): logging in to Proton Pass"
    timeout --foreground --kill-after=10s 2m pass-cli login
  fi

  # One image serves every zone, so the zone's session id is not in the
  # shared supervisor.env: add the one reference that is this zone's own.
  # Only pass:// references go in this file; the values are resolved by
  # pass-cli run and never touch disk.
  ENV_FILE=$(mktemp)
  trap 'rm -f "$ENV_FILE"' EXIT
  {
    cat "$DIR/supervisor.env"
    printf 'SUPERVISOR_SESSION_ID=pass://tidelands.dev/agent/SUPERVISOR_SESSION_ID_%s\n' \
      "$(printf '%s' "$ZONE" | tr 'a-z-' 'A-Z_')"
  } > "$ENV_FILE"

  pass-cli run --env-file "$ENV_FILE" -- bash "$0" --resolved
  exit $?
fi

# --resolved: the secrets are in the environment from here on.
: "${SUPERVISOR_SESSION_ID:?SUPERVISOR_SESSION_ID must come from the pass env file: one session per zone, forked from an existing one}"
: "${CLAUDE_CODE_OAUTH_TOKEN:?CLAUDE_CODE_OAUTH_TOKEN must come from the pass env file}"
: "${LINEAR_API_KEY:?LINEAR_API_KEY must come from the pass env file}"
: "${GCP_SERVICE_ACCOUNT_KEY:?GCP_SERVICE_ACCOUNT_KEY must come from the pass env file (restic)}"
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY must come from the pass env file}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD must come from the pass env file}"

# The toolbox's read-only tools, and the Linear server as a whole: the session
# works a Linear issue, so it reads and comments on it. Every toolbox tool
# that starts, stops, deletes or dispatches is spelled out as disallowed as
# well, so an allowlist that ever fails open still cannot move any
# infrastructure. Bash and the file-editing tools are disallowed for the same
# reason: with Bash the model could reach the toolbox over curl and route
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

prompt=$(sed \
  -e "s|{{ZONE}}|$ZONE|g" \
  -e "s|{{TZ}}|$ZONE_TZ|g" \
  -e "s|{{NOW}}|$(date -u +%FT%TZ)|g" \
  -e "s|{{LOCAL_NOW}}|$local_now|g" \
  -e "s|{{TO_MIDNIGHT}}|$to_midnight|g" \
  -e "s|{{SINCE_MIDNIGHT}}|$since_midnight|g" \
  "$DIR/prompt.md")

# 1. Restore. Same find and restore as `color resume`: the newest snapshot
# under the zone's tag that holds the session, because other runs back up
# under the same tag and "latest" is not necessarily the one with this
# transcript. No snapshot is a failed run -- resuming nothing would quietly
# start a different, amnesiac session.
echo "supervisor ($ZONE): restoring session $SUPERVISOR_SESSION_ID (restic tag $RESTIC_TAG)"
snap=$(restic find --json --tag "$RESTIC_TAG" "$SUPERVISOR_SESSION_ID.jsonl" |
  jq -r 'max_by(.matches[0].mtime) | .snapshot // empty') ||
  { echo "supervisor ($ZONE): restic find failed" >&2; exit 1; }
[ -n "$snap" ] || {
  echo "supervisor ($ZONE): no snapshot tagged $RESTIC_TAG holds session $SUPERVISOR_SESSION_ID" >&2
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
ls "$HOME"/.claude/projects/*/"$SUPERVISOR_SESSION_ID.jsonl" > /dev/null 2>&1 || {
  echo "supervisor ($ZONE): restoring snapshot $snap did not produce the session transcript" >&2
  exit 1
}

# 2. Resume, in the foreground. The prompt stays directly after -p and the
# variadic tool lists come last, or --allowedTools would swallow it.
# --remote-control registers the session with the account so it can be
# driven from the Claude app mid-window.
echo "supervisor ($ZONE): resuming session $SUPERVISOR_SESSION_ID"
claude_rc=0
# Deliberately unquoted: each tool name is its own argument.
# shellcheck disable=SC2086
out=$(timeout --signal=TERM --kill-after=30s "${SUPERVISOR_CLAUDE_TIMEOUT:-30m}" \
  claude --resume "$SUPERVISOR_SESSION_ID" --remote-control -p "$prompt" \
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
echo "supervisor ($ZONE): backing up session to restic tag $RESTIC_TAG"
backup_rc=0
(cd "$HOME" && restic backup .claude --tag "$RESTIC_TAG") || backup_rc=$?

failed=0
# 124 is timeout's TERM, 137 its KILL after the grace period.
case "$claude_rc" in
  0) ;;
  124 | 137)
    echo "supervisor ($ZONE): claude timed out after ${SUPERVISOR_CLAUDE_TIMEOUT:-30m} -- this window has no decision" >&2
    failed=1
    ;;
  *)
    echo "supervisor ($ZONE): claude exited $claude_rc -- this window has no decision" >&2
    failed=1
    ;;
esac
if [ "$backup_rc" -ne 0 ]; then
  echo "supervisor ($ZONE): restic backup exited $backup_rc -- the next run will resume from an older transcript" >&2
  failed=1
fi
[ "$failed" -eq 0 ] || exit 1

# A run that produced prose but never reached a decision is a broken
# instrument, not a window with nothing to do.
heartbeat=$(printf '%s\n' "$out" | grep -E '^SUPERVISOR_HEARTBEAT: zone=' | tail -1 || true)
case "$heartbeat" in
  *decision=*) echo "$heartbeat" ;;
  *)
    echo "supervisor ($ZONE): no SUPERVISOR_HEARTBEAT line carrying a decision" >&2
    exit 1
    ;;
esac
