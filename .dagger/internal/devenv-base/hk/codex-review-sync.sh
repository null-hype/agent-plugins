#!/usr/bin/env bash
# Posts the `codex review` runs captured by the latest codex-session-state
# snapshot as reviews on the GitHub PR for the branch each one reviewed. Each
# rollout transcript records its repo/branch/commit in session_meta.git and
# the structured verdict in its ExitedReviewMode item. Runs under hk's "check"
# hook next to linear-release -- a post-push sync, never a push gate.
set -euo pipefail
[ "$#" -eq 0 ] || { echo "usage: $0" >&2; exit 2; }

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/../.devcontainer/lib/gce-common.sh"

codex_review_sync() {
  local changed snap f rollout meta repo branch session pr review confidence verdict failed=0
  changed=$(gce_common_codex_changed_rollouts)
  [ -n "$changed" ] || { echo "no rollout transcripts changed in the latest snapshot" >&2; return 0; }
  rollout=$(mktemp)
  trap 'rm -f "$rollout"' RETURN

  while read -r snap f; do
    restic dump "$snap" "$f" > "$rollout"
    # A session can run `codex review` more than once; the last verdict is the
    # one that stands, and its content identifies it.
    review=$(jq -sc 'map(select(.payload.item.type? == "ExitedReviewMode"))[-1].payload.item.review_output // empty' "$rollout")
    [ -n "$review" ] || continue
    confidence=$(jq -r '.overall_confidence_score // empty' <<< "$review")
    [ -n "$confidence" ] || continue
    verdict=$(jq -cS . <<< "$review" | sha256sum | cut -c1-16)
    meta=$(jq -c 'select(.type == "session_meta") | .payload' "$rollout")
    # A review whose confidence is 0 inspected nothing (e.g. a sandbox
    # failure); posting it would read as an approval. The rest still sync,
    # but the run fails.
    if [ "$confidence" = 0 ]; then
      echo "$(jq -r '.id' <<< "$meta"): review has confidence 0 (inspected nothing) -- not posting" >&2
      failed=1
      continue
    fi

    repo=$(jq -r '.git.repository_url | sub("^https://github.com/"; "") | sub("\\.git$"; "")' <<< "$meta")
    branch=$(jq -r '.git.branch' <<< "$meta")
    session=$(jq -r '.id' <<< "$meta")

    pr=$(gh pr list --repo "$repo" --head "$branch" --state open --json number --jq '.[0].number // empty')
    [ -n "$pr" ] || { echo "$session: no open PR for $repo:$branch -- skipping" >&2; continue; }
    if gh api "repos/$repo/pulls/$pr/reviews" --paginate --jq '.[].body' | grep -qF "codex-review: $session:$verdict"; then
      echo "$session: this review ($verdict) is already posted to $repo#$pr" >&2
      continue
    fi

    # Pinned to the reviewed commit, so a branch that moved on since does not
    # show this verdict against code it never saw.
    jq --arg session "$session" --arg verdict "$verdict" --arg sha "$(jq -r '.git.commit_hash' <<< "$meta")" '
      . as $r
      | {event: "COMMENT", commit_id: $sha,
         body: ("**Codex review:** \($r.overall_correctness) (confidence \($r.overall_confidence_score))\n\n"
                + $r.overall_explanation
                + ($r.findings | map("\n\n---\n\n" + (. | tostring)) | join(""))
                + "\n\n<!-- codex-review: \($session):\($verdict) -->")}
    ' <<< "$review" | gh api "repos/$repo/pulls/$pr/reviews" --input - --jq '.html_url'
  done <<< "$changed"
  return "$failed"
}

gce_common_reserve_sa_key_file
export SA_KEY_FILE
# gcloud.env's GITHUB_TOKEN replaces the caller's inside `pass-cli run`; gh
# prefers GH_TOKEN, so the caller's own GitHub login is the one that posts.
export GH_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-$(gh auth token)}}"
export -f gce_common_write_sa_key gce_common_codex_changed_rollouts codex_review_sync
export PROTON_PASS_AGENT_REASON="codex-review-sync: post codex review findings from codex-session-state snapshots"

pass-cli run --env-file "$DIR/../.devcontainer/gcloud.env" -- \
  bash -c 'set -euo pipefail; gce_common_write_sa_key && codex_review_sync'
