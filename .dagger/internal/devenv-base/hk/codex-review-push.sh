#!/usr/bin/env bash
# Reviews every pushed branch with the local, already-authenticated Codex CLI
# (no OpenAI API key, no GitHub Action). hk's pre-push step starts this
# detached and returns at once, so the push is never held up by a review.
#
# hk keeps the pre-push stdin (the pushed refs) to itself, so the job finds
# what was pushed from the remote-tracking reflogs instead: once the push
# lands, git records an "update by push" entry for each ref it updated.
#
# For each pushed branch (the default branch is skipped) the job:
#   1. sets a `codex-review` commit status of pending on the pushed commit;
#   2. runs `codex exec review --base <remote>/<default>` in a throwaway
#      worktree at that commit, so the review sees exactly what was pushed;
#   3. posts the findings as a review on the open PR for the branch, pinned
#      to that commit (or as a commit comment when there is no PR yet);
#   4. sets the status: failure when there are findings, error when the
#      review could not run, success otherwise.
# Make `codex-review` a required status check on the default branch and a PR
# cannot merge until its head has a clean review.
#
# Usage: codex-review-push.sh            (from hk: start the job, detached)
#        codex-review-push.sh --job      (the job itself)
#        codex-review-push.sh --review <remote> <branch> <sha>
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$DIR" rev-parse --show-toplevel)"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/codex-review"
CONTEXT=codex-review
# Codex's own sandbox needs unprivileged user namespaces (bwrap), which this
# devcontainer does not allow; the review runs in a throwaway worktree.
CODEX_ARGS=(-c 'sandbox_mode="danger-full-access"')

log() { echo "$(date -u +%FT%TZ) $*"; }

repo_slug() {
  git -C "$REPO_ROOT" remote get-url "$1" |
    sed -E 's#^(https://github.com/|git@github.com:)##; s#\.git$##'
}

# A status that cannot be written is logged and fails the review at the end,
# but does not stop the review itself from being posted.
STATUS_FAILED=""
set_status() { # repo sha state description [target_url]
  gh api "repos/$1/statuses/$2" -f state="$3" -f context="$CONTEXT" \
    -f description="${4:0:140}" ${5:+-f target_url="$5"} --silent ||
    { log "could not set $CONTEXT=$3 on ${2:0:7}"; STATUS_FAILED=1; }
}

# Prints "<remote> <branch> <sha>" for every remote-tracking ref a push
# updated at or after $1 (unix seconds).
pushed_refs() {
  local since=$1 ref when msg
  git -C "$REPO_ROOT" for-each-ref --format='%(refname)' refs/remotes |
    while read -r ref; do
      [[ "$ref" == */HEAD ]] && continue
      read -r when msg < <(git -C "$REPO_ROOT" reflog show -n1 --date=unix --format='%gd %gs' "$ref" 2>/dev/null |
        sed -E 's/^[^@]*@\{([0-9]+)\} /\1 /') || continue
      [ "${msg:-}" = "update by push" ] && [ "${when:-0}" -ge "$since" ] || continue
      ref=${ref#refs/remotes/}
      echo "${ref%%/*} ${ref#*/} $(git -C "$REPO_ROOT" rev-parse "refs/remotes/$ref")"
    done
}

REVIEW_REPO="" REVIEW_SHA="" REVIEW_WT="" REVIEW_DONE=""
finish() { # like set_status, for a review's final outcome
  REVIEW_DONE=1
  set_status "$@"
}
on_review_exit() {
  local rc=$?
  [ -n "$REVIEW_DONE" ] || { log "review of ${REVIEW_SHA:0:7} exited ($rc) before finishing"; set_status "$REVIEW_REPO" "$REVIEW_SHA" error "Codex review failed before finishing"; }
  git -C "$REPO_ROOT" worktree remove --force "$REVIEW_WT" >/dev/null 2>&1 || true
}

review() { # remote branch sha
  local remote=$1 branch=$2 sha=$3 repo default wt events thread rollout out body state desc pr url
  repo=$(repo_slug "$remote")
  default=$(git -C "$REPO_ROOT" symbolic-ref --short "refs/remotes/$remote/HEAD" 2>/dev/null || echo "$remote/main")
  [ "$branch" = "${default#*/}" ] && { log "$branch is the default branch -- not reviewing"; return 0; }

  wt=$(mktemp -d "${TMPDIR:-/tmp}/codex-review.XXXXXX")
  events="$STATE_DIR/$sha.jsonl"
  # Runs on any exit once pending is set (this is its own process, see job):
  # a review that dies before setting its outcome must not stay pending.
  REVIEW_REPO=$repo REVIEW_SHA=$sha REVIEW_WT=$wt
  trap on_review_exit EXIT
  set_status "$repo" "$sha" pending "Codex is reviewing ${sha:0:7}"
  git -C "$REPO_ROOT" worktree add -q --detach "$wt" "$sha"
  # The QA pass in AGENTS.md drives Storybook with playwright-cli.
  [ -d "$REPO_ROOT/tutorial-app/node_modules" ] && ln -s "$REPO_ROOT/tutorial-app/node_modules" "$wt/tutorial-app/node_modules"

  log "reviewing $repo $branch@${sha:0:7} against $default"
  (cd "$wt" && codex exec review "${CODEX_ARGS[@]}" --base "$default" --json) > "$events" 2> "$STATE_DIR/$sha.err" || true

  thread=$(jq -r 'select(.type == "thread.started") | .thread_id' "$events" | head -1)
  rollout=$( [ -n "$thread" ] && find "${CODEX_HOME:-$HOME/.codex}/sessions" -name "*$thread*.jsonl" | head -1 || true)
  out=$( [ -n "$rollout" ] && jq -cs 'map(select(.payload.item.type? == "ExitedReviewMode"))[-1].payload.item.review_output // empty' "$rollout" || true)

  # A review that inspected nothing is a broken instrument, not a pass.
  if [ -z "$out" ] || [ "$(jq -r '.overall_confidence_score' <<< "$out")" = 0 ]; then
    log "no usable review for ${sha:0:7} (see $STATE_DIR/$sha.err)"
    finish "$repo" "$sha" error "Codex review did not run"
    return 1
  fi

  body=$(jq -r --arg sha "$sha" --arg thread "$thread" --arg wt "$wt/" '
    "**Codex review** of `\($sha[0:7])`: \(.overall_correctness) (confidence \(.overall_confidence_score))\n\n"
    + .overall_explanation
    + (.findings | map("\n\n---\n\n### \(.title)\n\n\(.body)\n\n`\(.code_location.absolute_file_path | ltrimstr($wt)):\(.code_location.line_range.start)-\(.code_location.line_range.end)`") | join(""))
    + "\n\n<!-- codex-session: \($thread) -->"' <<< "$out")

  pr=$(gh pr list --repo "$repo" --head "$branch" --state open --json number --jq '.[0].number // empty')
  if [ -n "$pr" ]; then
    url=$(jq -n --arg body "$body" --arg sha "$sha" '{event: "COMMENT", commit_id: $sha, body: $body}' |
      gh api "repos/$repo/pulls/$pr/reviews" --input - --jq '.html_url') || url=""
  else
    url=$(jq -n --arg body "$body" '{body: $body}' |
      gh api "repos/$repo/commits/$sha/comments" --input - --jq '.html_url') || url=""
  fi
  if [ -z "$url" ]; then
    log "could not post the review of ${sha:0:7}"
    finish "$repo" "$sha" error "Codex review ran but could not be posted"
    return 1
  fi
  log "posted $url"

  if [ "$(jq '.findings | length' <<< "$out")" -gt 0 ]; then
    state=failure desc="$(jq -r '.findings | length' <<< "$out") finding(s): $(jq -r '.findings[0].title' <<< "$out")"
  else
    state=success desc="No findings"
  fi
  finish "$repo" "$sha" "$state" "$desc" "$url"
  [ -z "$STATUS_FAILED" ]
}

job() {
  local since=$1 deadline found=""
  # The push itself is still in flight when hk starts this; wait for git to
  # record it. A push that fails records nothing, and the job gives up.
  deadline=$(( $(date +%s) + 600 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    found=$(pushed_refs "$since")
    [ -n "$found" ] && break
    sleep 5
  done
  [ -n "$found" ] || { log "no pushed refs recorded since $since -- nothing to review"; return 0; }
  sleep 5  # let a multi-ref push finish recording every ref
  # Each review is its own process, so errexit holds inside it (under
  # `review || ...` bash would switch errexit off for the whole function).
  local failed=0
  while read -r remote branch sha; do
    bash "${BASH_SOURCE[0]}" --review "$remote" "$branch" "$sha" || { log "review of $branch@${sha:0:7} failed"; failed=1; }
  done < <(pushed_refs "$since")
  return "$failed"
}

mkdir -p "$STATE_DIR"
case "${1:-}" in
  "")
    since=$(date +%s)
    nohup setsid bash "${BASH_SOURCE[0]}" --job "$since" >> "$STATE_DIR/review.log" 2>&1 < /dev/null &
    echo "codex-review: reviewing in the background (log: $STATE_DIR/review.log)"
    ;;
  --job) job "$2" ;;
  --review) review "$2" "$3" "$4" ;;
  *) echo "usage: $0 [--job <since> | --review <remote> <branch> <sha>]" >&2; exit 2 ;;
esac
