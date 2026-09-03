#!/usr/bin/env bash
# Verifies the integrity of the restic repo defined in pass://infra/restic.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/../.devcontainer/lib/gce-common.sh"

gce_common_reserve_sa_key_file
export SA_KEY_FILE
export -f gce_common_write_sa_key

export PROTON_PASS_AGENT_REASON="restic-check hook: fetch GCP SA key + restic repo credentials to verify repo integrity"

pass-cli run --env-file "$DIR/../.devcontainer/gcloud.env" -- \
  bash -c 'gce_common_write_sa_key && restic check'
