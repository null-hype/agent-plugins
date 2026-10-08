#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
python3 "$repo/scripts/cve-checker-viewer-export.py" \
  --output "$scratch/records" \
  --cache "${CIT337_CAPTURE_CACHE:-${TMPDIR:-/tmp}/cit337-captures}"
cp "$scratch/bundle.tar.gz" "$repo/tutorial-app/evidence/cit-337-captures-v1/bundle.tar.gz"
cp "$scratch/bundle.json" "$repo/tutorial-app/evidence/cit-337-captures-v1/bundle.json"

python3 "$repo/scripts/cve-forecast-viewer-export.py" \
  --output "$scratch/forecast/records" \
  --cache "${CIT338_CAPTURE_CACHE:-${TMPDIR:-/tmp}/cit338-captures}"
cp "$scratch/forecast/bundle.tar.gz" "$repo/tutorial-app/evidence/cit-338-captures-v1/bundle.tar.gz"
cp "$scratch/forecast/bundle.json" "$repo/tutorial-app/evidence/cit-338-captures-v1/bundle.json"
