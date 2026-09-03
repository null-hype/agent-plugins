#!/usr/bin/env bash
# Entrypoint for the devenv-keepalive image, run on a schedule as a Render
# Cron Job. Resets devpod's own INACTIVITY_TIMEOUT watchdog on the GCE-backed
# devenv-base-gce workspace so it doesn't auto-stop between real sessions,
# and (re)starts the linear-agent webhook server there via
# start-linear-agent.sh, since nothing else supervises it across restarts.
#
# Confirmed against devpod's source (cmd/agent/daemon.go, pkg/tunnel/
# container.go): the watchdog on the machine polls the mtime of a
# workspace.json file that is *only* ever touched by devpod's own tunnel
# (`<agent> agent workspace update-config`, run every 30s over an open
# `devpod ssh`/`devpod up` session). A raw SSH connection to the VM -- direct,
# Tailscale or otherwise -- never touches that file and cannot reset the
# timer. So this has to go through devpod's CLI, which in turn needs the
# local ~/.devpod client state that identifies which existing machine
# `devenv-base-gce` maps to (without it, `devpod up` silently provisions a
# *new* GCE instance instead of reattaching -- confirmed the hard way).
# Since this runs in an ephemeral Render Cron container with no persistent
# disk, that state round-trips through the shared devpod-state restic repo
# each run: pull, ping, push back (see gce_common_restic_{pull,push}_
# devpod_state in gce-common.sh -- the same repo devpod-gce.sh and the
# per-issue reconciler use, so all three agree on machine mappings).
set -euo pipefail

: "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:?PROTON_PASS_PERSONAL_ACCESS_TOKEN must be set}"
WORKSPACE_ID=${WORKSPACE_ID:-devenv-base-gce}
LIB_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.devcontainer/lib/gce-common.sh"
source "$LIB_FILE"
# Computed here, not inside the `bash -c` block below -- BASH_SOURCE[0]
# there would refer to that -c string, not this script.
KEEPALIVECORE_BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/keepalivecore"

export PROTON_PASS_KEY_PROVIDER=${PROTON_PASS_KEY_PROVIDER:-fs}
export PROTON_PASS_AGENT_REASON="devpod-keepalive: fetch GCP service account key"

if ! pass-cli info > /dev/null 2>&1; then
  pass-cli logout --force > /dev/null 2>&1 || true
  pass-cli login
fi

PASS_ENV_FILE=$(mktemp)
chmod 600 "$PASS_ENV_FILE"
gce_common_reserve_sa_key_file
cleanup() {
  shred -u "$PASS_ENV_FILE" "$SA_KEY_FILE" 2>/dev/null || rm -f "$PASS_ENV_FILE" "$SA_KEY_FILE"
}
trap cleanup EXIT

# JIN-63: development/restic is retired -- migrated to the "restic" item,
# now consolidated into the infra vault. Addressed here by vault-name/
# item-title rather than share-id/item-id: the share ID is minted per-share
# and goes stale whenever the share is recreated (see the JIN-63
# stale-share-id fix), while the vault name is the stable, human-assigned
# identifier Vaults.pkl's existence contract already declares this item
# under.
cat > "$PASS_ENV_FILE" <<'EOF'
GCP_SERVICE_ACCOUNT_KEY=pass://infra/restic/GCP_SERVICE_ACCOUNT_KEY
GOOGLE_PROJECT_ID=pass://infra/restic/GOOGLE_PROJECT_ID
RESTIC_REPOSITORY=pass://infra/restic/RESTIC_REPOSITORY
RESTIC_PASSWORD=pass://infra/restic/RESTIC_PASSWORD
EOF

export SA_KEY_FILE WORKSPACE_ID PROTON_PASS_PERSONAL_ACCESS_TOKEN LIB_FILE KEEPALIVECORE_BIN

# Hard wall-clock cap. Precautionary -- no run has actually hung yet. Render
# starts no new run while the previous one is still in flight, so a hung
# `devpod up`/`devpod ssh` here would not just fail one run, it would wedge
# the schedule for as long as it hung. Nothing below has an internal timeout,
# so the cap goes here, once, around the whole sequence. 30m is comfortably
# above a normal run (~2m, or ~7m when devpod has to cold-start the machine)
# and safely under the hourly schedule.
timeout --signal=TERM --kill-after=60s 30m \
  pass-cli run --env-file "$PASS_ENV_FILE" -- bash -c '
  set -euo pipefail
  source "$LIB_FILE"
  gce_common_write_sa_key
  gcloud auth activate-service-account --key-file="$SA_KEY_FILE" --project="$GOOGLE_PROJECT_ID" >/dev/null

  gce_common_restic_pull_devpod_state

  # JIN-133: the tunnel/timing/retry core (one long-lived devpod ssh
  # session covering all five bootstrap steps, held open past devpod'"'"'s 30s
  # watchdog-reset tick regardless of how fast the steps themselves run,
  # and the tailscale-down/devpod-up/retry state machine) has moved to a
  # compiled Go binary -- see keepalive/core, keepalive/devpodtunnel and
  # keepalive/retry. This script still owns everything around it: secrets,
  # pass-cli, and the restic pull/push state dance above/below. WORKSPACE_ID
  # and PROTON_PASS_PERSONAL_ACCESS_TOKEN, and KEEPALIVECORE_BIN itself, are
  # already exported into this subshell'"'"'s environment (see the `export`
  # line above the `timeout` invocation); keepalivecore reads the first two
  # directly.
  set +e
  "$KEEPALIVECORE_BIN"
  CORE_RC=$?
  set -e

  # JIN-63: continue-claude-session.sh step disabled per request -- was
  # erroring on every run (ssh tunnel/permission failures) without ever
  # affecting this job'"'"'s actual pass/fail (it was already tolerated).

  gce_common_restic_push_devpod_state

  if [ "$CORE_RC" -ne 0 ]; then
    echo "keepalivecore exited $CORE_RC -- tunnel/bootstrap sequence did not complete (see its own output above for which step); failing this run" >&2
    exit 1
  fi
'

# Final step, run locally in this container (not over `devpod ssh`) against
# the real public URL: confirms DNS/TLS/tunnel/process/secret all actually
# line up, since a truncated devpod ssh session above can otherwise look
# identical to a real success (the four steps above only prove *some* exit
# code came back, not that the webhook path is actually live). Deliberately
# outside the `pass-cli run --env-file "$PASS_ENV_FILE"` block above:
# check-linear-agent-webhook-live.sh opens its own `pass-cli run` against
# linear-agent.env, and nesting one `pass-cli run` inside another doesn't
# work. It reuses the pass-cli session established by the login check near
# the top of this script.
LIVE_CHECK_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.devcontainer/check-linear-agent-webhook-live.sh"
if [ ! -f "$LIVE_CHECK_SCRIPT" ]; then
  echo "check-linear-agent-webhook-live.sh not found at $LIVE_CHECK_SCRIPT -- the keepalive image build (Keepalive() in main.go) needs to copy .devcontainer/check-linear-agent-webhook-live.sh and .devcontainer/linear-agent.env alongside devpod-keepalive.sh/gce-common.sh; failing this run" >&2
  exit 1
fi

set +e
LIVE_OUT=$(bash "$LIVE_CHECK_SCRIPT" 2>&1)
LIVE_RC=$?
set -e
echo "$LIVE_OUT"

if ! printf '%s' "$LIVE_OUT" | grep -q "LIVE_WEBHOOK_CHECK: OK"; then
  echo "live webhook check failed (exit $LIVE_RC) -- the four bootstrap steps above reported success but the public webhook path is not actually live; failing this run" >&2
  exit 1
fi
