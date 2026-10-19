#!/usr/bin/env bash
# One dispatch window's supervisor run, for one zone (CIT-443).
#
# This is the dry run: the model gets the toolbox's read-only tools, reports
# what it would do with the window, and the run fails unless it reaches a
# decision. Nothing is started or stopped and nothing is written to Linear --
# the write tools are both left out of --allowedTools and named in
# --disallowedTools, and --strict-mcp-config keeps any other MCP server
# configured in the image from joining in.
#
# The record of a run is its Render log. The last line is a heartbeat, and
# its absence is what separates a quiet failure from a quiet success: a job
# that dies early reaps nothing and reports nothing, which otherwise looks
# exactly like a window where there was nothing to do.
#
# One zone per service, parameterised by SUPERVISOR_ZONE, the same way
# keepalive/devpod-keepalive.sh is parameterised by WORKSPACE_ID. Render's
# single-run guarantee is per service, so the job that reaps a stuck window
# is never the job that is stuck.
#
# Usage: supervisor.sh                (from Render: the image entrypoint)
#        supervisor.sh --bounded-run  (itself, re-executed under the timeout)
set -euo pipefail

# Bound the whole run, the Proton Pass login included: a login left
# unbounded can hang the job (observed for the keepalive on 2026-09-06), and
# the single-run guarantee turns a hung run into a *missed* next window
# rather than an overlapping one.
if [ "${1:-}" != "--bounded-run" ]; then
  exec timeout --signal=TERM --kill-after=60s "${SUPERVISOR_TIMEOUT:-15m}" \
    bash "$0" --bounded-run "$@"
fi
shift

: "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:?PROTON_PASS_PERSONAL_ACCESS_TOKEN must be set}"
: "${TOOLBOX_TOKEN:?TOOLBOX_TOKEN must be set: copy it from the env vars of the toolbox Render service}"
ZONE="${SUPERVISOR_ZONE:?SUPERVISOR_ZONE must be set: one Render cron service per zone}"
TOOLBOX_URL=${TOOLBOX_URL:-https://toolbox-spike.onrender.com/mcp}
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The toolbox's read-only tools. Every tool that starts, stops, deletes or
# dispatches is spelled out as disallowed as well, so an allowlist that ever
# fails open still cannot move any infrastructure. Bash and the file-editing
# tools are disallowed for the same reason: with Bash the model could reach
# the toolbox over curl and route around this list entirely.
READ_TOOLS="mcp__toolbox__ping
mcp__toolbox__host_status
mcp__toolbox__workspace_list
mcp__toolbox__workspace_status
mcp__toolbox__codespace_status
mcp__toolbox__codex_review_status"
WRITE_TOOLS="mcp__toolbox__host_start
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
chmod 600 "$MCP_FILE"
trap 'rm -f "$MCP_FILE"' EXIT
# The bearer token reaches claude through this file, never through a command
# line: argv is readable by every process in the container.
jq -n --arg url "$TOOLBOX_URL" --arg auth "Bearer $TOOLBOX_TOKEN" \
  '{mcpServers: {toolbox: {type: "http", url: $url, headers: {Authorization: $auth}}}}' \
  > "$MCP_FILE"

prompt=$(sed -e "s|{{ZONE}}|$ZONE|g" -e "s|{{NOW}}|$(date -u +%FT%TZ)|g" "$DIR/prompt.md")

export PROTON_PASS_KEY_PROVIDER=${PROTON_PASS_KEY_PROVIDER:-fs}
export PROTON_PASS_AGENT_REASON="supervisor ($ZONE): resolve the Claude Code token for a dry-run window check"

echo "supervisor ($ZONE): checking Proton Pass session"
if ! timeout --foreground --kill-after=10s 60s pass-cli info > /dev/null 2>&1; then
  timeout --foreground --kill-after=10s 60s pass-cli logout --force > /dev/null 2>&1 || true
  echo "supervisor ($ZONE): logging in to Proton Pass"
  timeout --foreground --kill-after=10s 2m pass-cli login
fi

rc=0
# Deliberately unquoted: each tool name is its own argument.
# shellcheck disable=SC2086
out=$(pass-cli run --env-file "$DIR/supervisor.env" -- \
  claude -p "$prompt" \
    --model "${SUPERVISOR_MODEL:-sonnet}" \
    --effort "${SUPERVISOR_EFFORT:-medium}" \
    --mcp-config "$MCP_FILE" --strict-mcp-config \
    --allowedTools $READ_TOOLS \
    --disallowedTools $WRITE_TOOLS) || rc=$?
printf '%s\n' "$out"

if [ "$rc" -ne 0 ]; then
  echo "supervisor ($ZONE): claude exited $rc -- this window has no decision" >&2
  exit 1
fi

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
