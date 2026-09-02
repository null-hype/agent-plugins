#!/usr/bin/env bash
# JIN-63 / JIN-69 remediation: rotate the GCP SA key + RESTIC_PASSWORD that
# leaked into the claude-code-session/jin-63 restic snapshot (488398a1), and
# prune that snapshot. See JIN-63-remediation.md for the full narrative.
#
# Run this on a machine with pass-cli/gcloud/gh/restic/jq already installed
# and authenticated (`pass-cli login` first) -- it is NOT meant to run inside
# the sandboxed container-use environment, which has no route to the vault
# or the GCP project.
#
# Usage: hk/rotate-jin63-secrets.sh <subcommand>
#   inspect-fields   Print the JSON shape of the `restic` vault item (no secret values)
#   inspect          Print the current SA email + old key id (no secret values)
#   rotate-gcp-key   Mint a new GCP SA key, store it in the vault (asks for confirmation)
#   revoke-old-key   Revoke the OLD GCP SA key (asks for confirmation) -- run only
#                    after confirming devpod-keepalive/devpod-gce work against the new key
#   rotate-restic-password   restic key add + update vault field (asks for confirmation)
#   remove-old-restic-key    restic key remove <old-key-id> (asks for confirmation)
#   prune-snapshot   restic forget --prune the compromised transcript snapshot (asks for confirmation)
#   check-codespace  Check whether the codespace that leaked GITHUB_TOKEN is stopped

set -euo pipefail

# The restic item is shared directly to this PAT (item-level share, not
# vault membership) -- so it must be addressed by share-id/item-id rather
# than --vault-name/--item-title. Resolve with:
#   pass-cli share list --output json | jq '.shares[] | select(.name=="restic")'
#   pass-cli item list --share-id <that share id> --output json
ITEM_SHARE_ID="${JIN63_ITEM_SHARE_ID:-JOCl2srAELGIFt4eps9bbiX1xFv66XgU_hEAJMTvFR0i-PQbyrVCAXhAXJNSVgravMjosFXZmfqkuGtfpqLMEw==}"
ITEM_ID="${JIN63_ITEM_ID:-LUAeiUgx_fX0aTZ3ECo8l-CVZlnKcuuoPbY9QrpaymZzUq6xEiFE-Lg_uUQAK_0RR25xRVgtGzFMu38wRCqTLw==}"
PROJECT="caldav-444421"
LEAK_TAGS=(--tag claude-code-session --tag jin-63)
LEAK_SNAPSHOT="488398a1"
CODESPACE_NAME_FRAGMENT="3b7ff1"
TMP_KEY_FILE=""

require() { command -v "$1" >/dev/null 2>&1 || { echo "missing required tool: $1" >&2; exit 1; }; }


# Your terminal harness doesn't seem to keep stdin open across an
# interactive read -- so confirmation is via an env var instead of a
# prompt. Set JIN63_CONFIRM=YES to allow the irreversible action to run.
confirm() {
  local prompt="$1"
  if [ "${JIN63_CONFIRM:-}" != "YES" ]; then
    echo "$prompt" >&2
    echo "re-run the same command with JIN63_CONFIRM=YES prefixed to proceed" >&2
    exit 1
  fi
}

# Retrieve a single named field from the restic vault item.
get_field() {
  local name="$1"
  PROTON_PASS_AGENT_REASON="JIN-63: read $name from restic vault item to rotate leaked GCP key / restic password" \
    pass-cli item view --share-id "$ITEM_SHARE_ID" --item-id "$ITEM_ID" --field "$name"
}

cmd_inspect_fields() {
  require pass-cli
  for f in GCP_SERVICE_ACCOUNT_KEY GOOGLE_PROJECT_ID RESTIC_REPOSITORY RESTIC_PASSWORD; do
    len="$(get_field "$f" 2>/dev/null | wc -c)"
    echo "$f: ${len} bytes"
  done
}

cmd_inspect() {
  require pass-cli; require jq
  local key_json; key_json="$(get_field GCP_SERVICE_ACCOUNT_KEY)"
  echo "service account: $(echo "$key_json" | jq -r .client_email)"
  echo "old key id to revoke after cutover: $(echo "$key_json" | jq -r .private_key_id)"
}

cmd_rotate_gcp_key() {
  require pass-cli; require jq; require gcloud
  local key_json; key_json="$(get_field GCP_SERVICE_ACCOUNT_KEY)"
  local sa_email; sa_email="$(echo "$key_json" | jq -r .client_email)"
  echo "service account: $sa_email"
  confirm "Mint a new GCP SA key for $sa_email and overwrite the vault field?"

  TMP_KEY_FILE="$(mktemp)"
  trap 'shred -u "$TMP_KEY_FILE" 2>/dev/null || rm -f "$TMP_KEY_FILE"' EXIT

  gcloud iam service-accounts keys create "$TMP_KEY_FILE" --iam-account="$sa_email" --project="$PROJECT"

  PROTON_PASS_AGENT_REASON="JIN-63: store newly rotated GCP SA key" \
    pass-cli item update --share-id "$ITEM_SHARE_ID" --item-id "$ITEM_ID" \
    --field "GCP_SERVICE_ACCOUNT_KEY=$(cat "$TMP_KEY_FILE")"

  echo "new key stored. Verify devpod-keepalive.sh / devpod-gce.sh succeed against it before running revoke-old-key."
}

cmd_revoke_old_key() {
  require pass-cli; require jq; require gcloud
  local old_key_id="${1:-}"
  [ -n "$old_key_id" ] || { echo "usage: revoke-old-key <OLD_KEY_ID>  (from 'inspect' run BEFORE rotate-gcp-key)" >&2; exit 1; }
  local key_json; key_json="$(get_field GCP_SERVICE_ACCOUNT_KEY)"
  local sa_email; sa_email="$(echo "$key_json" | jq -r .client_email)"
  confirm "Irreversibly revoke OLD key $old_key_id for $sa_email? Only do this after confirming the new key works."
  gcloud iam service-accounts keys delete "$old_key_id" --iam-account="$sa_email" --project="$PROJECT"
}

cmd_rotate_restic_password() {
  require pass-cli; require restic
  local repo; repo="$(get_field RESTIC_REPOSITORY)"
  local pass; pass="$(get_field RESTIC_PASSWORD)"
  confirm "Add a new restic repo key (you'll be prompted for the new password twice)?"
  RESTIC_REPOSITORY="$repo" RESTIC_PASSWORD="$pass" restic key add
  read -r -s -p "New restic password (to store in vault): " new_pass; echo
  PROTON_PASS_AGENT_REASON="JIN-63: store newly rotated restic repository password" \
    pass-cli item update --share-id "$ITEM_SHARE_ID" --item-id "$ITEM_ID" \
    --field "RESTIC_PASSWORD=$new_pass"
  echo "new password stored. Once devpod-keepalive/devpod-gce/continue-claude-session have picked it up, run remove-old-restic-key <old-key-id>."
}

cmd_remove_old_restic_key() {
  require pass-cli; require restic
  local old_key_id="${1:-}"
  [ -n "$old_key_id" ] || { echo "usage: remove-old-restic-key <OLD_KEY_ID>  (from 'restic key list')" >&2; exit 1; }
  local repo; repo="$(get_field RESTIC_REPOSITORY)"
  local pass; pass="$(get_field RESTIC_PASSWORD)"
  confirm "Irreversibly remove restic key $old_key_id?"
  RESTIC_REPOSITORY="$repo" RESTIC_PASSWORD="$pass" restic key remove "$old_key_id"
}

cmd_prune_snapshot() {
  require pass-cli; require restic
  local repo; repo="$(get_field RESTIC_REPOSITORY)"
  local pass; pass="$(get_field RESTIC_PASSWORD)"
  echo "matching snapshots:"
  RESTIC_REPOSITORY="$repo" RESTIC_PASSWORD="$pass" restic snapshots "${LEAK_TAGS[@]}"
  confirm "Irreversibly forget+prune snapshot $LEAK_SNAPSHOT (confirm it's the only match above)?"
  RESTIC_REPOSITORY="$repo" RESTIC_PASSWORD="$pass" restic forget "$LEAK_SNAPSHOT" --prune
  echo "Reminder: shred any local restore of this snapshot too (e.g. ~/.claude on boxes used to confirm the leak)."
}

cmd_check_codespace() {
  require gh
  gh codespace list --json name,state | jq --arg frag "$CODESPACE_NAME_FRAGMENT" \
    '.[] | select(.name | contains($frag))'
}

case "${1:-}" in
  inspect-fields) cmd_inspect_fields ;;
  inspect) cmd_inspect ;;
  rotate-gcp-key) cmd_rotate_gcp_key ;;
  revoke-old-key) shift; cmd_revoke_old_key "$@" ;;
  rotate-restic-password) cmd_rotate_restic_password ;;
  remove-old-restic-key) shift; cmd_remove_old_restic_key "$@" ;;
  prune-snapshot) cmd_prune_snapshot ;;
  check-codespace) cmd_check_codespace ;;
  *)
    echo "usage: $0 {inspect-fields|inspect|rotate-gcp-key|revoke-old-key <id>|rotate-restic-password|remove-old-restic-key <id>|prune-snapshot|check-codespace}" >&2
    exit 1
    ;;
esac
