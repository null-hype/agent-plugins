#!/usr/bin/env bash
# Attach-time smoke test: confirm the tools baked into the
# ghcr.io/null-hype/devenv-base image (see devcontainer.json) are actually
# on PATH and runnable, and report tailnet status. Runs via
# postAttachCommand on every attach (e.g. `zed --dev-container .`) — no
# separate CI harness needed for this.
set -euo pipefail

dagger version
container-use version
devpod version
pass-cli --version
linear-release --version
tailscale version
gcloud --version

if command -v tailscale > /dev/null && sudo tailscale status > /dev/null 2>&1; then
  echo "tailscale: connected"
else
  echo "tailscale: not joined yet"
fi
