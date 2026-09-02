#!/usr/bin/env bash
# Bootstrap step for the `.env` files EnvTemplates.pkl is the source of
# truth for -- equivalent to `cp env.example .env`. Run this by hand
# whenever one of those files is missing or a template in EnvTemplates.pkl
# changes; the generated files are gitignored, not committed.
#
# Usage: hk/generate-env-files.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

declare -A OUT=(
  [tailscale]=".devcontainer/tailscale.env"
  [gcloud]=".devcontainer/gcloud.env"
  [linear-release]="linear-release.env"
)

for name in "${!OUT[@]}"; do
  out="${OUT[$name]}"
  pkl eval pkl/EnvTemplates.pkl -x "render(\"$name\")" -f text > "$out"
  echo "wrote $out (from EnvTemplates.pkl template \"$name\")"
done
