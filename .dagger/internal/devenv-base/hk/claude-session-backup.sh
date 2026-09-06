#!/usr/bin/env bash
# Backs up ~/.claude and ~/.config/container-use to the shared restic repo
# (claude-session-state / container-use-state tags respectively), as disaster
# recovery in case this box is lost or rebuilt. See
# gce_common_restic_push_claude_session and
# gce_common_restic_push_container_use_state in gce-common.sh. The latter is
# what makes in-progress container-use environment state (bountybench-dagger
# worker runs not yet reviewed/merged by the supervisor) durable -- see
# CLAUDE.md's "Backing up environment state" section.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/../.devcontainer/lib/gce-common.sh"

gce_common_reserve_sa_key_file
export SA_KEY_FILE
REPO="$(basename "$(git -C "$DIR" rev-parse --show-toplevel)")"
BRANCH="$(git -C "$DIR" rev-parse --abbrev-ref HEAD)"
export PROTON_PASS_AGENT_REASON="claude-session-backup hook: repo=$REPO branch=$BRANCH"
export -f gce_common_write_sa_key gce_common_restic_push_claude_session gce_common_restic_push_container_use_state

# Best-effort: this is disaster recovery only (see comment above), so a
# backup failure must never block the push it's piggybacking on.
if ! pass-cli run --env-file "$DIR/../.devcontainer/gcloud.env" -- \
  bash -c 'set -eo pipefail; gce_common_write_sa_key && gce_common_restic_push_claude_session && gce_common_restic_push_container_use_state'; then
  echo "warning: ~/.claude / ~/.config/container-use restic backup failed -- continuing anyway (DR-only, not push-blocking)" >&2
fi
exit 0
