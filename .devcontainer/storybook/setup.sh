#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

# Match the replay tools installed by .github/actions/setup-replay-tools.
download_dir=$(mktemp -d)
trap 'rm -rf "$download_dir"' EXIT
curl --fail --silent --show-error --location \
  https://github.com/apple/pkl/releases/download/0.32.1/pkl-linux-amd64 \
  -o "$download_dir/pkl"
sudo install -m 0755 "$download_dir/pkl" /usr/local/bin/pkl
pkl --version
npm --prefix tutorial-app ci
