#!/usr/bin/env bash
# Provision (once) and start a GCE-backed devpod workspace running this
# repo's .devcontainer/devcontainer.json. GCP auth comes from Proton Pass on
# demand: the service account key is written to a 0600 tempfile only for the
# duration of the devpod call, then shredded. Extra args are forwarded to
# `devpod up` (e.g. --ide none, --recreate).
#
# Source is git:, not a local-folder upload: devpod's local-folder sync tars
# up the raw working tree -- including untracked build artifacts like
# linear-agent/node_modules -- and re-uploads it on every `up`/`--recreate`.
# devpod's local-folder extractor doesn't overwrite pre-existing symlinks on
# the remote side, so npm's node_modules/.bin/* symlinks reliably collided
# ("file exists") on the second and every subsequent run, killing the whole
# agent process. Cloning from git instead means only committed files land on
# the remote machine, so node_modules (already .gitignore'd) never ships.
# Deploys whatever commit DEVPOD_GCE_GIT_REF points at (default: main) --
# push before running this if you want local changes included.
#
# devcontainer.json no longer runs tailscale-up.sh/install-tools.sh via
# postStartCommand: devpod's GCE provider evaluates remoteEnv's
# ${localEnv:...} against the remote agent's env, not this host's shell (see
# loft-sh/devpod#1907), and actively blanks it for postStartCommand/
# postAttachCommand specifically -- there's no reliable way to forward a
# live token into those two named hooks. Instead, after `devpod up`
# provisions/starts the machine, this runs setup explicitly over `devpod
# ssh --command`, which is a plain exec (not a lifecycle hook devpod
# special-cases), so --set-env reliably delivers the token to it.
set -euo pipefail

: "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:?PROTON_PASS_PERSONAL_ACCESS_TOKEN must be set in this shell so it can be forwarded into the workspace}"

PROVIDER_NAME=${DEVPOD_GCE_PROVIDER:-gcloud-gce}
WORKSPACE_ID=${DEVPOD_GCE_WORKSPACE:-devenv-base-gce}
ZONE=${DEVPOD_GCE_ZONE:-us-central1-a}
GIT_URL=${DEVPOD_GCE_GIT_URL:-https://github.com/null-hype/devenv-base.git}
GIT_REF=${DEVPOD_GCE_GIT_REF:-main}
# devpod's own watchdog stops the VM after this much idle time, independent
# of anything the hourly Render keepalive cron does. The provider default
# (5m) turned out far shorter than the keepalive interval (hourly), so the
# box was only reachable ~5-10 minutes per hour and a Linear agent
# assignment landing in the other ~50 minutes hit a dead origin with no
# retry -- observed live against JIN-40. 90m comfortably covers the gap
# between keepalive runs.
INACTIVITY_TIMEOUT=${DEVPOD_GCE_INACTIVITY_TIMEOUT:-90m}
ENV_FILE="$(dirname "${BASH_SOURCE[0]}")/gcloud.env"
LIB_FILE="$(dirname "${BASH_SOURCE[0]}")/lib/gce-common.sh"

source "$LIB_FILE"
gce_common_reserve_sa_key_file
export SA_KEY_FILE PROVIDER_NAME ZONE GIT_URL GIT_REF WORKSPACE_ID PROTON_PASS_PERSONAL_ACCESS_TOKEN LIB_FILE INACTIVITY_TIMEOUT

if ! pass-cli info > /dev/null 2>&1; then
  pass-cli logout --force > /dev/null 2>&1 || true
  pass-cli login
fi

pass-cli run --env-file "$ENV_FILE" -- bash -c '
  set -euo pipefail
  source "$LIB_FILE"
  gce_common_write_sa_key
  gce_common_restic_pull_devpod_state

  # devenv-base is private, so devpod'"'"'s own anonymous HTTPS clone of
  # GIT_SOURCE on the freshly-provisioned GCE machine 404s/403s with no
  # credentials -- confirmed live as `clone repository: exit status 128`.
  # GITHUB_TOKEN comes from gcloud.env (pass://JIN-63/gh/GITHUB_TOKEN), same
  # env-file this whole block already runs under, so it'"'"'s never written to
  # disk or logged -- only interpolated into GIT_SOURCE in memory here.
  : "${GITHUB_TOKEN:?GITHUB_TOKEN must be set (see gcloud.env) to clone the private devenv-base repo}"
  GIT_SOURCE="git:https://${GITHUB_TOKEN}@${GIT_URL#https://}@${GIT_REF}"

  if ! devpod provider options "$PROVIDER_NAME" > /dev/null 2>&1; then
    devpod provider add gcloud --name "$PROVIDER_NAME" \
      -o PROJECT="$GOOGLE_PROJECT_ID" -o ZONE="$ZONE" \
      -o INACTIVITY_TIMEOUT="$INACTIVITY_TIMEOUT" --use
  else
    # Re-applied every run (not just on first add) so an existing provider
    # picks up a changed default without having to be deleted and re-added.
    devpod provider update "$PROVIDER_NAME" -o INACTIVITY_TIMEOUT="$INACTIVITY_TIMEOUT"
  fi

  # Default to no IDE unless the caller explicitly asked for one: devpod up
  # otherwise tries to launch VS Code locally/in-browser after provisioning,
  # which fails (`xdg-open`/`code` missing) in any headless environment --
  # and because this whole `bash -c` block has `set -e`, that failure was
  # silently aborting the script before it ever reached the devpod ssh calls
  # below, i.e. before tailscale-up.sh/install-tools.sh/start-linear-agent.sh
  # ever ran.
  IDE_ARGS=()
  case " $* " in
    *" --ide "*|*" --ide="*) ;;
    *) IDE_ARGS=(--ide none) ;;
  esac
  devpod up "$WORKSPACE_ID" --source "$GIT_SOURCE" --provider "$PROVIDER_NAME" --id "$WORKSPACE_ID" "${IDE_ARGS[@]}" "$@"

  # One `devpod ssh` call per bootstrap step via gce_common_ssh_step (see
  # gce-common.sh for why these aren'"'"'t &&-chained into one remote command).
  # Runs bare under this block'"'"'s `set -e`, so any step'"'"'s non-zero exit aborts
  # here -- unlike devpod-keepalive.sh, which applies its own tolerate/fail
  # policy per step.
  while IFS= read -r step; do
    if [ "$step" = "tailscale-up.sh" ]; then
      gce_common_ssh_step "$WORKSPACE_ID" "$step" \
        --set-env "PROTON_PASS_PERSONAL_ACCESS_TOKEN=$PROTON_PASS_PERSONAL_ACCESS_TOKEN"
    else
      gce_common_ssh_step "$WORKSPACE_ID" "$step"
    fi
  done < <(gce_common_bootstrap_steps)

  gce_common_restic_push_devpod_state
' bash "$@"
