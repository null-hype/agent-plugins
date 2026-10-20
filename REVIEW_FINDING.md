# [P2] [QA] Fail the sync when snapshot listing fails

At `.dagger/internal/devenv-base/.devcontainer/lib/gce-common.sh:218-222`, a failed `restic snapshots` is converted into an empty `ids` value inside `changed=$(gce_common_codex_changed_rollouts)` (codex-review-sync.sh:15). Bash clears errexit inside that command substitution; the helper then returns 0 for fewer than two snapshots. A backend/authentication failure therefore makes the new review sync report no changed transcripts and succeed, leaving reviews unpublished. Check and propagate the listing pipeline's failure before interpreting an empty result. This violates **A broken instrument fails the run. A refuted hypothesis is a result.**

QA: loaded the actual helper under `set -euo pipefail`, substituted a local `restic` function that prints a simulated backend failure and returns 17, then ran the sync's `changed=$(...)` / empty-result path. Observed `fewer than two ... snapshots`, `no rollout transcripts changed`, and exit 0. No real service was called.

PR: https://github.com/null-hype/agent-plugins/pull/231
Linear: CIT-444
Environment: summary-snapper
Branch attachment: https://github.com/null-hype/agent-plugins/tree/cit-444-p2-qa-fail-the-sync-when-snapshot-listing-fails
