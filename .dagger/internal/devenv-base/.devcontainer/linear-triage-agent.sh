#!/usr/bin/env bash
# For each Linear issue carrying $LINEAR_TRIAGE_LABEL, compile a fresh,
# disposable working directory (the issue plus its comment thread, and the
# ExitPlanMode->Linear hook from .devcontainer/linear-triage/) and run
# headless claude against it in plan mode. The hook is the only write path
# back to Linear -- it files a new triage issue from whatever plan claude
# proposes. There is no persistent session/state carried between issues or
# between runs: the label marks what still needs review, the issue thread
# is the context, and the filed triage issue is the output. A human reviews
# and acts on triage issues; this never mutates the source issue itself.
#
# Requires on $PATH: bash, jq, curl, claude. Requires in the environment:
# LINEAR_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, LINEAR_QUERY_FILE (path to
# linear-query.sh). LINEAR_TRIAGE_LABEL and CLAUDE_MAX_BUDGET_USD are
# optional (defaulted below).
#
# LINEAR_TRIAGE_ISSUES, also optional, names issues directly as a
# comma-separated list of identifiers ("CIT-439" or "CIT-439,CIT-412") and
# takes precedence over the label. That is the per-issue loop: one cron
# service per issue, each naming its issue in an env var, the way each
# supervisor service names its zone. Everything downstream is unchanged --
# same compiled workdir, same plan mode, same hook as the only write path.
set -euo pipefail
: "${LINEAR_API_KEY:?LINEAR_API_KEY not set}"
: "${LINEAR_QUERY_FILE:?LINEAR_QUERY_FILE not set}"

LABEL="${LINEAR_TRIAGE_LABEL:-agent-triage}"
BUDGET="${CLAUDE_MAX_BUDGET_USD:-1}"
RUN_DIR="${LINEAR_TRIAGE_RUN_DIR:-/app/run}"
HOOK_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/linear-triage/hooks/exit-plan-to-linear.sh"
SETTINGS_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/linear-triage/settings.json"

# The same per-issue body, whichever way the issue was selected.
ISSUE_FIELDS='id identifier title description url team { id } comments { nodes { body user { name } createdAt } }'

# Two ways to choose what a run reviews. The label is the standing sweep:
# whatever carries it is waiting for review. LINEAR_TRIAGE_ISSUES names
# issues outright, which is what a per-issue loop wants -- one cron
# service per issue, the issue named in an env var, the same way each
# supervisor service names its zone. Naming issues ignores the label
# entirely, so a loop cannot be widened by someone labelling something.
if [ -n "${LINEAR_TRIAGE_ISSUES:-}" ]; then
  echo "linear-triage-agent: reviewing named issue(s): $LINEAR_TRIAGE_ISSUES" >&2
  NODES=""
  while IFS= read -r identifier; do
    [ -n "$identifier" ] || continue
    # Linear's issue(id:) accepts a human identifier such as CIT-439, so
    # each named issue is one lookup; there is no identifier filter on the
    # issues() connection to batch them with.
    node="$(jq -n --arg id "$identifier" --arg f "$ISSUE_FIELDS" '{
      query: "query($id: String!) { issue(id: $id) { \($f) } }",
      variables: {id: $id}
    }' | bash "$LINEAR_QUERY_FILE" | jq -c '.data.issue // empty')"
    if [ -z "$node" ]; then
      echo "linear-triage-agent: $identifier not found, or the query failed" >&2
      exit 1
    fi
    NODES="$NODES$node"$'\n'
  done < <(printf '%s\n' "$LINEAR_TRIAGE_ISSUES" | tr ',' '\n' | tr -d '[:blank:]')
  ISSUES="$(printf '%s' "$NODES")"
else
  # The jq variable is $lbl, not $label: `label` is a jq keyword (label/break),
  # so `--arg label` produces a program jq cannot even compile -- which is how
  # this path came to be broken on every run (jq 1.6, "unexpected label").
  # The GraphQL variable inside the query string stays $label.
  QUERY=$(jq -n --arg lbl "$LABEL" --arg f "$ISSUE_FIELDS" '{
    query: "query($label: String!) { issues(filter: { labels: { name: { eq: $label } } }) { nodes { \($f) } } }",
    variables: {label: $lbl}
  }')

  RESPONSE="$(echo "$QUERY" | bash "$LINEAR_QUERY_FILE")"

  if ! echo "$RESPONSE" | jq -e '.data.issues.nodes' >/dev/null 2>&1; then
    echo "linear-triage-agent: Linear query failed: $RESPONSE" >&2
    exit 1
  fi

  COUNT="$(echo "$RESPONSE" | jq '.data.issues.nodes | length')"
  echo "linear-triage-agent: $COUNT issue(s) labeled \"$LABEL\"" >&2
  ISSUES="$(echo "$RESPONSE" | jq -c '.data.issues.nodes[]')"
fi

printf '%s\n' "$ISSUES" | while IFS= read -r issue; do
  [ -n "$issue" ] || continue
  IDENTIFIER="$(echo "$issue" | jq -r '.identifier')"
  ISSUE_DIR="$RUN_DIR/$IDENTIFIER"

  echo "linear-triage-agent: compiling $IDENTIFIER -> $ISSUE_DIR" >&2
  mkdir -p "$ISSUE_DIR/.claude/hooks"
  cp "$HOOK_SRC" "$ISSUE_DIR/.claude/hooks/exit-plan-to-linear.sh"
  chmod +x "$ISSUE_DIR/.claude/hooks/exit-plan-to-linear.sh"
  cp "$SETTINGS_SRC" "$ISSUE_DIR/.claude/settings.local.json"

  echo "$issue" | jq -r '
    "# " + .title
    + "\n\n" + (.description // "(no description)")
    + "\n\n## URL\n" + .url
    + "\n\n## Comments\n"
    + ( [.comments.nodes[] | "- **" + .user.name + "** (" + .createdAt + "): " + .body] | join("\n") )
  ' > "$ISSUE_DIR/ISSUE.md"

  (
    cd "$ISSUE_DIR"
    export SOURCE_ISSUE_IDENTIFIER="$IDENTIFIER"
    export SOURCE_ISSUE_URL="$(echo "$issue" | jq -r '.url')"
    export LINEAR_TEAM_ID="$(echo "$issue" | jq -r '.team.id')"
    export LINEAR_API_KEY LINEAR_QUERY_FILE

    # See continue-claude-session.sh for the same --allowedTools/--
    # terminator lesson this mirrors: --allowedTools takes a variadic
    # <tools...> list, so a `--` terminator is required before the trailing
    # prompt or it silently swallows the prompt as another list entry.
    claude --print \
      --model sonnet \
      --permission-mode plan \
      --max-budget-usd "$BUDGET" \
      --allowedTools "Read" "Bash(bash $LINEAR_QUERY_FILE:*)" \
      -- "Review ISSUE.md, a Linear issue and its comment thread. Decide whether and how it should be resolved, then call ExitPlanMode with your proposed plan. You may use the Linear query tool (bash \$LINEAR_QUERY_FILE) for read-only follow-up lookups if the thread alone isn't enough context. Do not attempt to write to Linear yourself -- filing the triage issue happens automatically when you exit plan mode."
  )
done

echo "linear-triage-agent: done" >&2
