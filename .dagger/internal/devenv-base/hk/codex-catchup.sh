#!/usr/bin/env bash
# CIT-254: lets an agent get oriented from `pass-cli login` alone. Diffs the
# two most recent codex-session-state snapshots and prints, per changed
# rollout transcript, the user's own messages from it -- the fast summary of
# recent work, instead of restoring and reading the whole ~/.codex directory.
set -euo pipefail
[ "$#" -eq 0 ] || { echo "usage: $0" >&2; exit 2; }

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/../.devcontainer/lib/gce-common.sh"

codex_catchup() {
  local ids old new changed f
  ids=$(restic snapshots --tag codex-session-state --json | jq -r '.[-2:][].id')
  if [ "$(printf '%s\n' "$ids" | grep -c .)" -lt 2 ]; then
    echo "fewer than two codex-session-state snapshots -- nothing to diff yet" >&2
    return 0
  fi
  old=$(printf '%s\n' "$ids" | sed -n 1p)
  new=$(printf '%s\n' "$ids" | sed -n 2p)

  changed=$(restic diff "$old" "$new" | awk '/\/sessions\/.*\.jsonl$/ && ($1 == "M" || $1 == "+") {print $2}')
  if [ -z "$changed" ]; then
    echo "no rollout transcripts changed between $old and $new" >&2
    return 0
  fi

  while IFS= read -r f; do
    echo "=== $f ==="
    restic dump "$new" "$f" | jq -r '
      select(.type == "response_item") | .payload |
      select(.type == "message" and .role == "user") |
      (.content // []) | map(.text // empty) | join(" ")
    ' | grep -v '^$'
  done <<< "$changed"
}

gce_common_reserve_sa_key_file
export SA_KEY_FILE
export -f gce_common_write_sa_key codex_catchup
export PROTON_PASS_AGENT_REASON="codex-catchup: read codex-session-state snapshots to summarize recent work"

pass-cli run --env-file "$DIR/../.devcontainer/gcloud.env" -- \
  bash -c 'gce_common_write_sa_key && codex_catchup'
