#!/usr/bin/env bash
# Direct Linear GraphQL access via LINEAR_API_KEY (a Linear personal API
# key -- Settings -> API -> Personal API keys). Used by
# linear-triage-agent.sh to query for issues to review, and available to
# the per-issue claude invocation itself as an allowed Bash tool for any
# follow-up lookups beyond the seeded issue+thread context.
#
# Personal API keys go directly in the Authorization header with NO
# "Bearer " prefix (confirmed against exit-plan-to-linear.sh, which already
# uses this same key this way) -- adding one gets a silent auth failure,
# not a clear 401.
#
# Usage: pass a GraphQL request body (the {"query": ..., "variables": ...}
# JSON, same shape the Linear API docs use) on stdin. Prints Linear's raw
# JSON response on stdout.
set -euo pipefail
: "${LINEAR_API_KEY:?LINEAR_API_KEY not set}"

QUERY_JSON="$(cat)"

curl -sS --max-time 15 -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  --data "$QUERY_JSON"
