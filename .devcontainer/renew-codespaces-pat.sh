#!/usr/bin/env bash
# Renew the Proton Pass PAT used for Codespaces secret sync and push the new
# value to the target repo's Codespaces secret. Run this well ahead of the
# PAT's expiration (see PAT_EXPIRATION below) via cron/systemd timer on
# tidelands -- see JIN-30 for the manual runs this formalizes.
set -euo pipefail

REPO=${REPO:-null-hype/devenv-base}
SECRET_NAME=${SECRET_NAME:-PROTON_PASS_PERSONAL_ACCESS_TOKEN}
PAT_NAME=${PAT_NAME:-production.tidelands.dev}
PAT_EXPIRATION=${PAT_EXPIRATION:-1y}

export PROTON_PASS_KEY_PROVIDER=${PROTON_PASS_KEY_PROVIDER:-fs}
export PROTON_PASS_AGENT_REASON="renew-codespaces-pat: renew PAT and sync to Codespaces secret"

NEW_PAT=$(pass-cli pat renew --pat-name "$PAT_NAME" --expiration "$PAT_EXPIRATION")
echo "$NEW_PAT" | gh secret set "$SECRET_NAME" --repo "$REPO" --app codespaces
echo "renew-codespaces-pat: renewed '$PAT_NAME' and updated '$SECRET_NAME' on $REPO"
