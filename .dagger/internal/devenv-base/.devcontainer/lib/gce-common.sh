#!/usr/bin/env bash
# Shared helpers for devpod-gce.sh and keepalive/devpod-keepalive.sh.
# Sourced, not executed -- callers must already have `set -euo pipefail`.

# The postStartCommand/postAttachCommand hooks in devcontainer.json can't
# receive a live PROTON_PASS_PERSONAL_ACCESS_TOKEN (devpod's GCE provider
# blanks remoteEnv's ${localEnv:...} for those two named hooks specifically --
# see loft-sh/devpod#1907), so both callers instead run bootstrap steps
# explicitly over `devpod ssh --command`, a plain exec devpod doesn't
# special-case, right after `devpod up`/`devpod ssh` brings the machine up.
# Each step (generate-env-files.sh, tailscale-up.sh, install-tools.sh,
# start-linear-agent.sh, start-cloudflared.sh) runs as its own separate
# `devpod ssh` invocation rather than one &&-chained command: a single
# combined session was observed
# (repeatedly, on live hourly runs) truncating right after install-tools.sh
# finishes -- devpod reporting "remote command exited without exit status or
# exit signal" -- with no output at all from the steps after it, yet the run
# still reporting success. Splitting the chain isolates each step's own
# tunnel/exit code. gce_common_ssh_step below issues exactly one `devpod ssh`
# per call and returns that call's real exit code, so the sequence is shared
# without ever combining steps into one remote command string; callers still
# decide their own per-step failure policy (see devpod-gce.sh and
# keepalive/devpod-keepalive.sh for how each uses it).

# One `devpod ssh --command "bash <scripts-dir>/<script>"` invocation for a
# single bootstrap step, where <scripts-dir> is DEVENV_BASE_DEVCONTAINER_DIR
# (default: .dagger/internal/devenv-base/.devcontainer, matching where the
# agent-plugins clone puts these scripts on the remote box). Prints the
# step's combined stdout/stderr (callers that want to inspect it should
# capture this function's output) and returns the real exit code of that one
# `devpod ssh` call -- never masked by `local` or a `set +e`/`set -e` toggle.
# Extra args (e.g. `--set-env FOO=bar`) go before $2 to land ahead of
# `--command` on the devpod ssh invocation.
gce_common_ssh_step() {
  local workspace="$1" script="$2"
  shift 2
  local scripts_dir="${DEVENV_BASE_DEVCONTAINER_DIR:-.dagger/internal/devenv-base/.devcontainer}"
  local out rc=0
  out=$(devpod ssh "$workspace" "$@" --command "bash $scripts_dir/$script" 2>&1) || rc=$?
  printf '%s\n' "$out"
  return "$rc"
}

# The bootstrap sequence, in order, shared so it's defined once.
# Callers that just want to run all four under one failure policy can loop
# over this; keepalive/devpod-keepalive.sh instead calls gce_common_ssh_step
# per step directly, since it has to interleave its own tailscale-up retry
# and per-step tolerate/fail policy between them.
gce_common_bootstrap_steps() {
  printf '%s\n' \
    "generate-env-files.sh" \
    "tailscale-up.sh" \
    "install-tools.sh" \
    "start-linear-agent.sh" \
    "start-cloudflared.sh"
}

# Reserve a 0600 tempfile for the GCP service account key and arrange for it
# to be shredded on exit. Sets SA_KEY_FILE. Call from the outer (unprivileged)
# shell, before pass-cli run.
gce_common_reserve_sa_key_file() {
  SA_KEY_FILE=$(mktemp)
  chmod 600 "$SA_KEY_FILE"
  trap 'shred -u "$SA_KEY_FILE" 2>/dev/null || rm -f "$SA_KEY_FILE"' EXIT
}

# Write $GCP_SERVICE_ACCOUNT_KEY to $SA_KEY_FILE and point
# GOOGLE_APPLICATION_CREDENTIALS at it. Call from inside the `pass-cli run`
# subshell, where GCP_SERVICE_ACCOUNT_KEY is populated.
gce_common_write_sa_key() {
  umask 077
  printf "%s" "$GCP_SERVICE_ACCOUNT_KEY" > "$SA_KEY_FILE"
  export GOOGLE_APPLICATION_CREDENTIALS="$SA_KEY_FILE"
}

# devpod's local ~/.devpod client state (which existing GCE machine each
# workspace id maps to) has to agree across every caller that touches it --
# devpod-gce.sh (manual), devpod-keepalive.sh (cron), and the per-issue
# reconciler -- or `devpod up` provisions a duplicate machine instead of
# reattaching. All three transport it through one shared restic repo
# (RESTIC_REPOSITORY/RESTIC_PASSWORD, read natively by the restic CLI) rather
# than each inventing its own bucket round-trip. Call both from inside the
# `pass-cli run` subshell, where those two env vars are populated.

# Restore ~/.devpod from the latest devpod-state snapshot. No-ops with a
# warning if the repo genuinely has no such snapshot yet (fresh repo / first
# run anywhere) -- same "go seed it" situation the old bucket-tarball flow
# had. Any other failure of the existence check itself (network blip, GCS
# hiccup, auth glitch) aborts loudly instead -- this used to `2>/dev/null`
# and treat that identically to "no snapshot yet", silently proceeding with
# an empty ~/.devpod. Since gce_common_restic_push_devpod_state below
# unconditionally pushes whatever ~/.devpod ends up holding, that false
# equivalence let one transient restic error permanently wipe the real
# devenv-base-gce -> devenv-bas-2ec4a machine mapping in the shared repo
# (confirmed live: happened between the 05:17 and 06:16 UTC hourly cron runs
# on 2026-08-24, traced via JIN-63).
gce_common_restic_pull_devpod_state() {
  mkdir -p ~/.devpod
  local snap_json
  if ! snap_json=$(restic snapshots --tag devpod-state --latest 1 --json 2>&1); then
    echo "restic snapshots --tag devpod-state failed -- refusing to continue with a possibly-empty ~/.devpod, since a later push would overwrite real state with this run's blank slate:" >&2
    printf '%s\n' "$snap_json" >&2
    return 1
  fi
  if ! printf '%s' "$snap_json" | grep -q '"id"'; then
    echo "no devpod-state restic snapshot found yet -- run this once from a machine with a working ~/.devpod to seed it (this call pushes one on success)" >&2
    return 0
  fi
  (cd ~ && restic restore latest --tag devpod-state --target .)
}

# Snapshot ~/.devpod back to the restic repo. Call after a successful
# devpod up/ssh sequence so whichever component runs next sees this
# machine's updated state.
gce_common_restic_push_devpod_state() {
  (cd ~ && restic backup .devpod --tag devpod-state)
}

# Claude session state (~/.claude, on the devpod itself) backed up under a
# separate tag in the same shared repo. Unlike ~/.devpod above, this box's
# disk is already the live, authoritative copy of the session the whole
# time -- these two calls are disaster recovery only, in case the GCE
# instance is lost or rebuilt, not a per-tick restore-then-run cycle. Call
# both from inside the `pass-cli run` subshell, where
# RESTIC_REPOSITORY/RESTIC_PASSWORD are populated. Only caller today is
# continue-claude-session.sh, which runs over `devpod ssh` (on the devpod),
# not devpod-keepalive.sh/devpod-gce.sh (which run gce_common_restic_*_
# devpod_state above on the Render cron container instead) -- same shared
# repo, different machine, different tag.
gce_common_restic_pull_claude_session() {
  mkdir -p ~/.claude
  if ! restic snapshots --tag claude-session-state --latest 1 --json 2>/dev/null | grep -q '"id"'; then
    echo "no claude-session-state restic snapshot found yet -- first successful run on this box will seed it (this call pushes one on success)" >&2
    return 0
  fi
  (cd ~ && restic restore latest --tag claude-session-state --target .)
}

gce_common_restic_push_claude_session() {
  (cd ~ && restic backup .claude --tag claude-session-state)
}
