#!/usr/bin/env bash
# PostToolUse hook for ExitPlanMode, adapted from the interactive-session
# version built in container-use env massive-asp
# (.claude/hooks/exit-plan-to-linear.sh). That version opens its own
# pass-cli session per invocation, for a human's long-running interactive
# session where LINEAR_API_KEY isn't otherwise in the process env. This
# version runs inside linear-triage-agent.sh's per-issue claude invocation,
# where LINEAR_API_KEY and LINEAR_TEAM_ID are already exported into the
# environment by the parent script -- so it just uses them directly instead
# of running pass-cli again.
#
# LINEAR_API_KEY must be a Linear *personal* API key -- it goes in the
# Authorization header with NO "Bearer " prefix; adding one is a silent
# auth failure, not a 401 (confirmed against the original hook).
#
# The issue this files is informational triage output for a human to
# review and act on -- this never mutates the source issue itself.
#
# Like the original, this runs after ExitPlanMode already returned -- it
# can't block or influence that tool call. Failures are logged to stderr
# and swallowed (exit 0) so a Linear/network hiccup doesn't look like a
# broken Claude Code run.
set -euo pipefail

PAYLOAD="$(cat)"
PLAN="$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.plan // empty' 2>/dev/null || true)"

if [ -z "$PLAN" ]; then
  exit 0
fi

TITLE="$(printf '%s' "$PLAN" | jq -Rs -r '
  split("\n")
  | map(select(test("\\S")))
  | (.[0] // "")
  | sub("^#+\\s*"; "")
' 2>/dev/null || true)"
if [ -z "$TITLE" ]; then
  TITLE="Triage - $(date -u +%Y-%m-%dT%H:%M:%SZ)"
fi
if [ -n "${SOURCE_ISSUE_IDENTIFIER:-}" ]; then
  TITLE="Triage: $SOURCE_ISSUE_IDENTIFIER - $TITLE"
fi
TITLE="${TITLE:0:80}"

DESCRIPTION="$PLAN"
if [ -n "${SOURCE_ISSUE_URL:-}" ]; then
  DESCRIPTION="Proposed by an unattended plan-mode review of ${SOURCE_ISSUE_URL}. A human should review before acting on it.

$PLAN"
fi

: "${LINEAR_API_KEY:?LINEAR_API_KEY not set in environment}"
: "${LINEAR_TEAM_ID:?LINEAR_TEAM_ID not set in environment}"

BODY=$(jq -n --arg title "$TITLE" --arg desc "$DESCRIPTION" --arg team "$LINEAR_TEAM_ID" '{
  query: "mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }",
  variables: {input: {title: $title, description: $desc, teamId: $team}}
}')

RESPONSE=$(curl -sS --max-time 15 -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  --data "$BODY")

if ! echo "$RESPONSE" | jq -e ".data.issueCreate.success == true" > /dev/null 2>&1; then
  echo "exit-plan-to-linear (triage): Linear issueCreate failed: $RESPONSE" >&2
  exit 0
fi

CREATED="$(echo "$RESPONSE" | jq -r '.data.issueCreate.issue.identifier // "issue"')"
echo "exit-plan-to-linear (triage): created $CREATED for source ${SOURCE_ISSUE_IDENTIFIER:-unknown}" >&2
exit 0
