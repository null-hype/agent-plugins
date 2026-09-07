#!/usr/bin/env bash
# Authenticate and sync DevPod state around the Go keepalive runner.
set -euo pipefail

# Bound the entire run, including Proton Pass login and state synchronization. A timeout only around `pass-cli run` leaves login free to hang and
# block later cron runs (observed on 2026-09-06 before any GCP auth output).
if [ "${1:-}" != "--bounded-run" ]; then
  exec timeout --signal=TERM --kill-after=60s "${KEEPALIVE_TIMEOUT:-30m}" \
    bash "$0" --bounded-run "$@"
fi
shift

: "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:?PROTON_PASS_PERSONAL_ACCESS_TOKEN must be set}"
WORKSPACE_ID=${WORKSPACE_ID:-devenv-base-gce}
LIB_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.devcontainer/lib/gce-common.sh"
source "$LIB_FILE"

export PROTON_PASS_KEY_PROVIDER=${PROTON_PASS_KEY_PROVIDER:-fs}
export PROTON_PASS_AGENT_REASON="devpod-keepalive: fetch GCP service account key"

# Keep nested timeouts in the outer timeout's process group so its deadline
# also terminates their descendants.
echo "keepalive: checking Proton Pass session"
if ! timeout --foreground --kill-after=10s 60s pass-cli info > /dev/null 2>&1; then
  timeout --foreground --kill-after=10s 60s pass-cli logout --force > /dev/null 2>&1 || true
  echo "keepalive: logging in to Proton Pass"
  timeout --foreground --kill-after=10s 2m pass-cli login
fi

PASS_ENV_FILE=$(mktemp)
chmod 600 "$PASS_ENV_FILE"
gce_common_reserve_sa_key_file
cleanup() {
  shred -u "$PASS_ENV_FILE" "$SA_KEY_FILE" 2>/dev/null || rm -f "$PASS_ENV_FILE" "$SA_KEY_FILE"
}
trap cleanup EXIT

cat > "$PASS_ENV_FILE" <<'EOF'
GCP_SERVICE_ACCOUNT_KEY=pass://infra/restic/GCP_SERVICE_ACCOUNT_KEY
GOOGLE_PROJECT_ID=pass://infra/restic/GOOGLE_PROJECT_ID
RESTIC_REPOSITORY=pass://infra/restic/RESTIC_REPOSITORY
RESTIC_PASSWORD=pass://infra/restic/RESTIC_PASSWORD
TS_AUTHKEY=pass://infra/tailscale/TS_AUTHKEY
EOF

export SA_KEY_FILE WORKSPACE_ID PROTON_PASS_PERSONAL_ACCESS_TOKEN LIB_FILE

pass-cli run --env-file "$PASS_ENV_FILE" -- bash -c '
  set -euo pipefail
  source "$LIB_FILE"
  gce_common_write_sa_key
  gcloud auth activate-service-account --key-file="$SA_KEY_FILE" --project="$GOOGLE_PROJECT_ID" >/dev/null

  gce_common_restic_pull_devpod_state

  devpod-keepalive keepalive --workspace "$WORKSPACE_ID"

  gce_common_restic_push_devpod_state

'
