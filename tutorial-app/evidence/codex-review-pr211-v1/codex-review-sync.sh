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
  local changed snap f rollout meta repo branch session pr
  changed=$(gce_common_codex_changed_rollouts)
  [ -n "$changed" ] || { echo "no rollout transcripts changed in the latest snapshot" >&2; return 0; }
  rollout=$(mktemp)
  trap 'rm -f "$rollout"' RETURN

  while read -r snap f; do
    restic dump "$snap" "$f" > "$rollout"
    # A review whose confidence is 0 inspected nothing (e.g. a sandbox
    # failure); posting it would read as an approval.
    jq -e 'select(.payload.item.type? == "ExitedReviewMode")
           | .payload.item.review_output.overall_confidence_score > 0' "$rollout" >/dev/null || continue

    meta=$(jq -c 'select(.type == "session_meta") | .payload' "$rollout")
    repo=$(jq -r '.git.repository_url | sub("^https://github.com/"; "") | sub("\\.git$"; "")' <<< "$meta")
    branch=$(jq -r '.git.branch' <<< "$meta")
    session=$(jq -r '.id' <<< "$meta")

    pr=$(gh pr list --repo "$repo" --head "$branch" --state open --json number --jq '.[0].number // empty')
    [ -n "$pr" ] || { echo "$session: no open PR for $repo:$branch -- skipping" >&2; continue; }
    if gh api "repos/$repo/pulls/$pr/reviews" --paginate --jq '.[].body' | grep -qF "codex-session: $session"; then
      echo "$session: already posted to $repo#$pr" >&2
      continue
    fi

    jq -s --arg session "$session" '
      (map(select(.payload.item.type? == "ExitedReviewMode"))[-1].payload.item.review_output) as $r
      | {event: "COMMENT",
         body: ("**Codex review:** \($r.overall_correctness) (confidence \($r.overall_confidence_score))\n\n"
                + $r.overall_explanation
                + ($r.findings | map("\n\n---\n\n" + (. | tostring)) | join(""))
                + "\n\n<!-- codex-session: \($session) -->")}
    ' "$rollout" | gh api "repos/$repo/pulls/$pr/reviews" --input - --jq '.html_url'
  done <<< "$changed"
}

gce_common_reserve_sa_key_file
export SA_KEY_FILE
export -f gce_common_write_sa_key gce_common_codex_changed_rollouts codex_review_sync
export PROTON_PASS_AGENT_REASON="codex-review-sync: post codex review findings from codex-session-state snapshots"

pass-cli run --env-file "$DIR/../.devcontainer/gcloud.env" -- \
  bash -c 'set -euo pipefail; gce_common_write_sa_key && codex_review_sync'
