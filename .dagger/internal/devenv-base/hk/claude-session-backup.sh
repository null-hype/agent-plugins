#!/usr/bin/env bash
# Backs up ~/.claude to the shared restic repo under the claude-session-state
# tag, as disaster recovery in case this box is lost or rebuilt. See
# gce_common_restic_push_claude_session in gce-common.sh.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/../.devcontainer/lib/gce-common.sh"

gce_common_reserve_sa_key_file
export SA_KEY_FILE
export -f gce_common_write_sa_key gce_common_restic_push_claude_session

# Best-effort: this is disaster recovery only (see comment above), so a
# backup failure must never block the push it's piggybacking on.
if ! pass-cli run --env-file "$DIR/../.devcontainer/gcloud.env" -- \
  bash -c 'set -eo pipefail; gce_common_write_sa_key && gce_common_restic_push_claude_session'; then
  echo "warning: ~/.claude restic backup failed -- continuing anyway (DR-only, not push-blocking)" >&2
fi
exit 0
