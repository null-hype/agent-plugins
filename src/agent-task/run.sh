#!/bin/bash

# One Claude Code task, run by the agent-task bin (the feature's
# postStartCommand): Claude works in AGENT_TASK_WORKSPACE with every tool and
# commits; then, if AGENT_TASK_REVIEW, codex-session reviews the commits
# Claude made. origin's push URL points nowhere first, so nothing leaves the
# container. Whatever happens is recorded in $OUT/result.json -- this always
# exits 0, so a failed task never blocks the container from starting.

set -uo pipefail

SHARE="${AGENT_TASK_SHARE:?run through the agent-task bin}"
OUT=/tmp/agent-task
mkdir -p "$OUT"
result() { jq -n "$@" > "$OUT/result.json"; cat "$OUT/result.json"; exit 0; }

PROMPT=$(cat "$SHARE/prompt.txt")
[ -n "$PROMPT" ] || result '{skipped: "no prompt"}'
[ -n "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:-}" ] || result '{skipped: "PROTON_PASS_PERSONAL_ACCESS_TOKEN not set"}'

export PROTON_PASS_KEY_PROVIDER=fs
export PROTON_PASS_AGENT_REASON="agent-task: Claude token and restic secrets for this task"
pass-cli info >/dev/null 2>&1 || timeout 2m pass-cli login >&2 || result '{error: "pass-cli login failed"}'

cd "$AGENT_TASK_WORKSPACE" || result --arg ws "$AGENT_TASK_WORKSPACE" '{error: "no workspace \($ws)"}'
base=$(git rev-parse HEAD) || result '{error: "the workspace is not a git checkout with a commit"}'
git remote get-url origin >/dev/null 2>&1 && git remote set-url --push origin no-push

IS_SANDBOX=1 pass-cli run --env-file "$SHARE/.env" -- \
    claude -p --model "$AGENT_TASK_MODEL" --permission-mode bypassPermissions \
           --output-format stream-json --verbose "$PROMPT" > "$OUT/claude.jsonl" 2> "$OUT/claude.err"
claude_result=$(jq -c 'select(.type == "result") | {subtype, result}' "$OUT/claude.jsonl" | tail -1)
commits=$(git rev-list --count "$base..HEAD")

review='null'
if [ "$AGENT_TASK_REVIEW" = true ] && [ "$commits" -gt 0 ]; then
    # codex exec review --base takes a branch: name the commit Claude started from.
    git branch -f agent-task-base "$base"
    if PASS_CLI_ENV_FILE="$SHARE/.env" codex-session review "$PWD" --base agent-task-base > "$OUT/review.json" 2> "$OUT/review.err"; then
        review=$(cat "$OUT/review.json")
    fi
fi

result --argjson claude "${claude_result:-null}" --argjson commits "$commits" --argjson review "$review" \
    --arg base "$base" --arg head "$(git rev-parse HEAD)" \
    '{claude: $claude, base: $base, head: $head, commits: $commits, review: $review}'
