#!/usr/bin/env bash
# Captures the current Proton Pass vault/item topology as JSON, for
# pkl/Vaults.test.pkl to compare against the declared inventory in
# pkl/Vaults.pkl. Read-only: vault and item *listings* only (titles/ids),
# never field values -- `item list` without --show-secrets never touches
# secret content, and --show-secrets is refused for agent sessions anyway.
# See JIN-116.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(basename "$(git -C "$DIR" rev-parse --show-toplevel)")"
BRANCH="$(git -C "$DIR" rev-parse --abbrev-ref HEAD)"
export PROTON_PASS_AGENT_REASON="capture-vault-inventory hook: repo=$REPO branch=$BRANCH"

OUT_DIR="$DIR/../build"
OUT="$OUT_DIR/vaults-observed.json"
mkdir -p "$OUT_DIR"

vault_names="$(pass-cli vault list --output json | jq -r '.vaults[].name')"

per_vault=()
while IFS= read -r name; do
  [ -n "$name" ] || continue
  items="$(pass-cli item list --vault-name "$name" --output json --filter-state active | jq -c '[.items[].title]')"
  per_vault+=("$(jq -n --arg name "$name" --argjson items "$items" '{name: $name, items: $items}')")
done <<< "$vault_names"

printf '%s\n' "${per_vault[@]}" | jq -s '{vaults: .}' > "$OUT"
echo "wrote $OUT ($(jq '.vaults | length' "$OUT") vaults)" >&2
