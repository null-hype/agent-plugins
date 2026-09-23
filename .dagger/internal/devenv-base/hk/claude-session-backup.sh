#!/usr/bin/env bash
# Separate snapshots for Claude, container-use, and Codex in the shared repo.
# Always reports its real exit status -- a failed backup blocks the push
# instead of being silently swallowed (CIT-254: a --best-effort mode used to
# convert a real failure into exit 0, which made a failed backup
# indistinguishable from a skipped one).
set -euo pipefail
[ "$#" -eq 0 ] || { echo "usage: $0" >&2; exit 2; }

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/../.devcontainer/lib/gce-common.sh"
gce_common_reserve_sa_key_file
export SA_KEY_FILE
export PROTON_PASS_KEY_PROVIDER=${PROTON_PASS_KEY_PROVIDER:-fs}
export PROTON_PASS_AGENT_REASON="session backup: Claude, container-use, and Codex snapshots"
export -f gce_common_write_sa_key gce_common_restic_retry gce_common_restic_push_claude_session \
  gce_common_restic_push_container_use_state gce_common_restic_push_codex_session \
  gce_common_restic_prune gce_common_restic_push_sessions

pass-cli run --env-file "$DIR/../.devcontainer/gcloud.env" -- \
  bash -c 'set -euo pipefail; gce_common_write_sa_key; gce_common_restic_push_sessions'
