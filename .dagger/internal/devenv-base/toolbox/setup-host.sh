#!/usr/bin/env bash
# One-time setup for the toolbox host, run from an authenticated devenv shell:
#
#   bash .dagger/internal/devenv-base/toolbox/setup-host.sh
#
# 1. Creates the host VM (Debian 12, no service account, guest attributes
#    on so its SSH host keys can be read through the Compute API), or, if it
#    exists, replaces its toolbox SSH key.
# 2. Creates the toolbox-render service account, allowed to administer that
#    one instance and nothing else, and a key for it. If the deploy account
#    may not do that, Render gets the deploy account's key instead.
# 3. Writes GCP_SERVICE_ACCOUNT_KEY, TOOLBOX_SSH_KEY, GITHUB_TOKEN and
#    PROTON_PASS_PERSONAL_ACCESS_TOKEN to the Render service and redeploys.
#
# Secrets go from Proton Pass to Render through files in a 0700 tempdir and
# curl's stdin; none is printed or put in a command line.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ENV_DIR=$HERE/../.devcontainer
export ZONE=${TOOLBOX_HOST_ZONE:-us-central1-a}
export NAME=${TOOLBOX_HOST_NAME:-toolbox-host}
export MACHINE_TYPE=${TOOLBOX_HOST_MACHINE_TYPE:-e2-standard-4}
export RENDER_SERVICE=${TOOLBOX_RENDER_SERVICE:-srv-dba7ibijnfac73elst20}
export STARTUP=$HERE/host-startup.sh

export PROTON_PASS_AGENT_REASON="toolbox setup-host: create the toolbox host VM and configure the Render toolbox service"
pass-cli run --env-file "$ENV_DIR/gcloud.env" --env-file "$ENV_DIR/render.env" \
  --env-file <(echo PROTON_PASS_PERSONAL_ACCESS_TOKEN=pass://tidelands.dev/pass-cli/PROTON_PASS_PERSONAL_ACCESS_TOKEN) \
  -- bash -euo pipefail -c '
  tmp=$(mktemp -d)
  chmod 700 "$tmp"
  trap "rm -rf $tmp" EXIT
  export CLOUDSDK_CONFIG=$tmp/gcloud
  printf %s "$GCP_SERVICE_ACCOUNT_KEY" > "$tmp/admin.json"
  gcloud auth activate-service-account --key-file="$tmp/admin.json" --quiet
  gcloud config set project "$GOOGLE_PROJECT_ID" --quiet
  P=$GOOGLE_PROJECT_ID

  ssh-keygen -q -t ed25519 -N "" -C toolbox -f "$tmp/id"
  echo "toolbox:$(cat "$tmp/id.pub")" > "$tmp/ssh-keys"

  if gcloud compute instances describe "$NAME" --zone "$ZONE" >/dev/null 2>&1; then
    echo "== $NAME exists; replacing its toolbox SSH key and startup script"
    gcloud compute instances add-metadata "$NAME" --zone "$ZONE" \
      --metadata enable-guest-attributes=TRUE \
      --metadata-from-file ssh-keys="$tmp/ssh-keys",startup-script="$STARTUP"
  else
    echo "== creating $NAME"
    gcloud compute instances create "$NAME" --zone "$ZONE" \
      --machine-type "$MACHINE_TYPE" \
      --image-family debian-12 --image-project debian-cloud \
      --boot-disk-size 100GB --boot-disk-type pd-balanced \
      --no-service-account --no-scopes \
      --labels purpose=toolbox-host \
      --metadata enable-guest-attributes=TRUE \
      --metadata-from-file ssh-keys="$tmp/ssh-keys",startup-script="$STARTUP"
  fi

  # Prefer an account limited to this instance. The deploy account may not
  # be allowed to create one; then Render gets the deploy key, which the
  # Proton Pass token it also holds can read anyway.
  SA=toolbox-render@$P.iam.gserviceaccount.com
  if { gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 ||
       gcloud iam service-accounts create toolbox-render --display-name "Render toolbox: one host VM"; } &&
     gcloud compute instances add-iam-policy-binding "$NAME" --zone "$ZONE" \
       --member "serviceAccount:$SA" --role roles/compute.instanceAdmin.v1 --quiet >/dev/null &&
     gcloud iam service-accounts keys create "$tmp/render-sa.json" --iam-account "$SA" --quiet; then
    echo "== using $SA"
  else
    echo "== WARNING: could not set up $SA; Render gets the deploy service account key" >&2
    cp "$tmp/admin.json" "$tmp/render-sa.json"
  fi

  printf %s "$GITHUB_TOKEN" > "$tmp/github"
  printf %s "$PROTON_PASS_PERSONAL_ACCESS_TOKEN" > "$tmp/pass"
  put() {
    jq -n --rawfile v "$2" "{value: \$v}" |
      curl -fsS -o /dev/null -X PUT -H "Authorization: Bearer $RENDER_API_KEY" \
        -H "Content-Type: application/json" --data @- \
        "https://api.render.com/v1/services/$RENDER_SERVICE/env-vars/$1"
    echo "== Render: set $1"
  }
  put GCP_SERVICE_ACCOUNT_KEY "$tmp/render-sa.json"
  put TOOLBOX_SSH_KEY "$tmp/id"
  put GITHUB_TOKEN "$tmp/github"
  put PROTON_PASS_PERSONAL_ACCESS_TOKEN "$tmp/pass"
  curl -fsS -X POST -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" \
    -d "{}" "https://api.render.com/v1/services/$RENDER_SERVICE/deploys" | jq -r "\"== Render: deploy \(.id)\""
'
