#!/bin/bash

# One Claude Code task, run by the agent-task bin (the feature's
# postStartCommand): Claude works in AGENT_TASK_WORKSPACE with every tool and
# commits; then, if AGENT_TASK_REVIEW, codex-session reviews the commits
# Claude made. origin's push URL points nowhere first, so nothing leaves the
# container. Whatever happens is recorded in $OUT/result.json -- this always
# exits 0, so a failed task never blocks the container from starting.
#
# AGENT_TASK_LINEAR: the codespace was made for one Linear agent session,
# whose id is its display name (Render's dispatcher names it so). The prompt
# comes from that session; after the review the commits are pushed to
# agent/<session> with a PR, the outcome is posted to the session, and the
# codespace deletes itself. A marker in /workspaces keeps a restarted
# codespace from running the task twice.

set -uo pipefail

SHARE="${AGENT_TASK_SHARE:?run through the agent-task bin}"
OUT=/tmp/agent-task
mkdir -p "$OUT"
record() { jq -n "$@" > "$OUT/result.json"; cat "$OUT/result.json"; }
result() { record "$@"; exit 0; }

PROMPT=$(cat "$SHARE/prompt.txt")
[ "$AGENT_TASK_LINEAR" = true ] && [ -z "${CODESPACE_NAME:-}" ] && result '{skipped: "linear mode runs in a codespace"}'
[ -n "$PROMPT" ] || [ "$AGENT_TASK_LINEAR" = true ] || result '{skipped: "no prompt"}'
[ -n "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:-}" ] || result '{skipped: "PROTON_PASS_PERSONAL_ACCESS_TOKEN not set"}'

export PROTON_PASS_KEY_PROVIDER=fs
export PROTON_PASS_AGENT_REASON="agent-task: Claude token and restic secrets for this task"
pass-cli info >/dev/null 2>&1 || timeout 2m pass-cli login >&2 || result '{error: "pass-cli login failed"}'

linear() { pass-cli run --env-file "$SHARE/linear.env" -- bash "$SHARE/linear.sh" "$@"; }
if [ "$AGENT_TASK_LINEAR" = true ]; then
    session=$(pass-cli run --env-file "$SHARE/linear.env" -- gh api "user/codespaces/$CODESPACE_NAME" --jq .display_name 2> "$OUT/linear.err") ||
        result --rawfile err "$OUT/linear.err" '{error: "could not read the codespace display name", stderr: $err}'
    done_marker="/workspaces/.agent-task/$session.done"
    [ -e "$done_marker" ] && result --arg s "$session" '{skipped: "session \($s) already done"}'
    mkdir -p "$(dirname "$done_marker")" && touch "$done_marker"
    PROMPT=$(linear prompt "$session") || {
        linear post "$session" error "Codespace $CODESPACE_NAME could not read this session's prompt." || true
        result --arg s "$session" '{error: "no prompt from Linear session \($s)"}'
    }
    PROMPT+=$'\n\n'"Work in this checkout and commit when the change is done. Do not push: your commits are pushed to a branch and opened as a pull request after you finish."
    linear post "$session" thought "Working in codespace $CODESPACE_NAME." || true
fi

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

if [ "$AGENT_TASK_LINEAR" = true ]; then
    summary=$(jq -r '.result // "Claude ended without a result."' <<< "${claude_result:-null}")
    pr=''
    if [ "$commits" -gt 0 ]; then
        branch="agent/${session:0:8}"
        git remote set-url --push origin "$(git remote get-url origin)"
        if git push --quiet origin "HEAD:refs/heads/$branch" &&
            pr=$(pass-cli run --env-file "$SHARE/linear.env" -- gh pr create --head "$branch" \
                --title "$(git log -1 --format=%s)" --body "$(git log --reverse --format=%B "$base..HEAD")"); then
            summary+=$'\n\n'"Opened $pr ($commits commit(s))."
        else
            summary+=$'\n\n'"Pushing $branch failed; the commits are still in codespace $CODESPACE_NAME."
        fi
    fi
    [ "$review" != null ] && summary+=$'\n\n'"Codex review: $(jq -r '.review | "\(.overall_correctness). \(.overall_explanation)"' <<< "$review")"
    linear post "$session" response "$summary" || true
fi

record --argjson claude "${claude_result:-null}" --argjson commits "$commits" --argjson review "$review" \
    --arg base "$base" --arg head "$(git rev-parse HEAD)" \
    '{claude: $claude, base: $base, head: $head, commits: $commits, review: $review}'

# Last, since it ends this container: keep the codespace while it holds
# commits that did not reach a PR (its --retention-period still applies).
if [ "$AGENT_TASK_LINEAR" = true ] && { [ "$commits" -eq 0 ] || [ -n "$pr" ]; }; then
    pass-cli run --env-file "$SHARE/linear.env" -- gh codespace delete -c "$CODESPACE_NAME" --force >&2 || true
fi
exit 0
