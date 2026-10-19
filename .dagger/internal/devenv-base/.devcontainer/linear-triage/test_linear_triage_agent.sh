#!/usr/bin/env bash
# Stub tests for linear-triage-agent.sh: no network, no credentials, no
# model. A stub stands in for linear-query.sh and answers either query
# shape, and a stub `claude` records the directory and argv it was handed.
#
# This exists because the label path shipped broken and nothing noticed:
# `label` is a jq keyword, so `jq --arg label` produced a program jq could
# not compile, and every run died on its first query. The agent's only
# output is a filed Linear issue, so a run that selects nothing looks
# exactly like a run with nothing to do -- the same quiet-failure shape the
# supervisor's required heartbeat is there to break.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT="$DIR/../linear-triage-agent.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/bin"

cat > "$WORK/stub-query.sh" <<'STUB'
#!/usr/bin/env bash
# Answers both selection shapes, so either path can be exercised.
payload="$(cat)"
label="$(printf '%s' "$payload" | jq -r '.variables.label // empty')"
if [ -n "$label" ]; then
  jq -n --arg l "$label" '{data: {issues: {nodes: [
    {id: "uuid-a", identifier: "CIT-900", title: ("Labelled "+$l), description: "d",
     url: "https://linear.app/CIT-900", team: {id: "team-1"}, comments: {nodes: []}}
  ]}}}'
else
  id="$(printf '%s' "$payload" | jq -r '.variables.id // "none"')"
  jq -n --arg id "$id" '{data: {issue: {id: ("uuid-"+$id), identifier: $id,
    title: ("Named "+$id), description: "d", url: ("https://linear.app/"+$id),
    team: {id: "team-1"}, comments: {nodes: []}}}}'
fi
STUB

cat > "$WORK/bin/claude" <<'STUB'
#!/usr/bin/env bash
{
  echo "CWD $(pwd)"
  echo "ARGV $*"
} >> "$CLAUDE_CALLS"
STUB

chmod +x "$WORK/stub-query.sh" "$WORK/bin/claude"

run_agent() {
  CLAUDE_CALLS="$WORK/calls.txt" \
  PATH="$WORK/bin:$PATH" \
  LINEAR_API_KEY=stub \
  LINEAR_QUERY_FILE="$WORK/stub-query.sh" \
  LINEAR_TRIAGE_RUN_DIR="$WORK/run" \
    bash "$AGENT" 2>&1
}

fail() { echo "FAIL: $1" >&2; exit 1; }

# 1. Naming issues reviews exactly those, including the last one -- the list
#    is split on commas, and a missing trailing newline used to drop the tail.
rm -rf "$WORK/run" "$WORK/calls.txt"; : > "$WORK/calls.txt"
out=$(LINEAR_TRIAGE_ISSUES="CIT-439, CIT-412" run_agent) || fail "named run exited nonzero: $out"
grep -q 'compiling CIT-439' <<<"$out" || fail "first named issue not compiled: $out"
grep -q 'compiling CIT-412' <<<"$out" || fail "last named issue dropped: $out"
[ "$(grep -c '^CWD ' "$WORK/calls.txt")" = 2 ] || fail "expected 2 claude calls, got: $(cat "$WORK/calls.txt")"
[ -f "$WORK/run/CIT-439/ISSUE.md" ] || fail "no ISSUE.md compiled for CIT-439"
grep -q '^# Named CIT-439' "$WORK/run/CIT-439/ISSUE.md" || fail "ISSUE.md missing the title"

# 2. The hook is installed as the write path, and claude runs in the issue dir.
[ -x "$WORK/run/CIT-439/.claude/hooks/exit-plan-to-linear.sh" ] || fail "hook not installed executable"
grep -q 'ExitPlanMode' "$WORK/run/CIT-439/.claude/settings.local.json" || fail "settings missing the ExitPlanMode hook"
grep -q "^CWD $WORK/run/CIT-439$" "$WORK/calls.txt" || fail "claude did not run in the issue dir: $(cat "$WORK/calls.txt")"

# 3. Plan mode, and the prompt survives the variadic --allowedTools list: a
#    missing `--` terminator swallows it as another tool name.
grep -q 'permission-mode plan' "$WORK/calls.txt" || fail "not run in plan mode"
grep -qE 'allowedTools Read .*-- Review ISSUE\.md' "$WORK/calls.txt" ||
  fail "prompt did not survive the tool list: $(cat "$WORK/calls.txt")"

# 4. Naming issues ignores the label, so a per-issue loop cannot be widened
#    by someone labelling something else.
rm -rf "$WORK/run" "$WORK/calls.txt"; : > "$WORK/calls.txt"
out=$(LINEAR_TRIAGE_ISSUES="CIT-439" LINEAR_TRIAGE_LABEL=agent-triage run_agent) ||
  fail "named+label run exited nonzero: $out"
grep -q 'CIT-900' <<<"$out" && fail "the label was swept even though issues were named: $out"

# 5. The label path still selects -- this is the case that was broken.
rm -rf "$WORK/run" "$WORK/calls.txt"; : > "$WORK/calls.txt"
out=$(run_agent) || fail "label run exited nonzero: $out"
grep -q '1 issue(s) labeled "agent-triage"' <<<"$out" || fail "label path selected nothing: $out"
grep -q 'compiling CIT-900' <<<"$out" || fail "labelled issue not compiled: $out"

# 6. A named issue Linear does not return is an error, not an empty sweep.
cat > "$WORK/stub-query.sh" <<'STUB'
#!/usr/bin/env bash
cat > /dev/null
echo '{"data":{"issue":null}}'
STUB
chmod +x "$WORK/stub-query.sh"
rm -rf "$WORK/run"
if out=$(LINEAR_TRIAGE_ISSUES="CIT-000" run_agent); then
  fail "a missing issue was treated as success: $out"
fi
grep -q 'CIT-000 not found' <<<"$out" || fail "missing issue not reported: $out"

echo "linear-triage-agent stub tests: ok"
