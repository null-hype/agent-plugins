#!/usr/bin/env bash
# GCE startup script for the toolbox host (Debian 12). It runs as root on
# every boot and is idempotent: it installs Docker, jq and git, Tailscale,
# the pinned Codex and DevPod CLIs, and DevPod's docker provider for the
# toolbox user. It
# touches $READY last; host_status reports ready only once it exists.
set -euo pipefail

READY=/var/lib/toolbox-host.ready
rm -f "$READY"

DEVPOD_VERSION=v0.6.15
# Upstream publishes no checksums; this is the release asset's sha256.
DEVPOD_SHA256=cc50bce09229d5a6d448ac1d4494327f4b8f7a20321e5fcee3bfec1aef0d20c5

# bubblewrap is Codex's sandbox on Linux.
if ! command -v docker >/dev/null || ! command -v jq >/dev/null || ! command -v bwrap >/dev/null; then
  apt-get update
  apt-get install -y docker.io jq git curl bubblewrap
fi

# Same installer as the Dagger module's withTailscale. The toolbox joins the
# tailnet on its first host_status, with Tailscale SSH, and tailscaled keeps
# the node's state across reboots.
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
systemctl enable --now tailscaled

# Codex CLI for reviews. Log in once over Tailscale SSH as the toolbox user
# (`codex login --device-auth`); the login stays in /home/toolbox/.codex.
CODEX_VERSION=0.163.0
CODEX_SHA256=beb339e8ecd9ba057a6bb2dc81ad8ca474812edfbf0fc5056ca818797648dde4
if [ "$(codex --version 2>/dev/null)" != "codex-cli $CODEX_VERSION" ]; then
  curl -fsSL -o /tmp/codex.tgz "https://github.com/openai/codex/releases/download/rust-v$CODEX_VERSION/codex-x86_64-unknown-linux-musl.tar.gz"
  echo "$CODEX_SHA256  /tmp/codex.tgz" | sha256sum -c --quiet
  tar -xzf /tmp/codex.tgz -C /tmp codex-x86_64-unknown-linux-musl
  install -m 0755 /tmp/codex-x86_64-unknown-linux-musl /usr/local/bin/codex
  rm -f /tmp/codex.tgz /tmp/codex-x86_64-unknown-linux-musl
fi

if ! echo "$DEVPOD_SHA256  /usr/local/bin/devpod" | sha256sum -c --quiet >/dev/null 2>&1; then
  curl -fsSL -o /tmp/devpod "https://github.com/loft-sh/devpod/releases/download/$DEVPOD_VERSION/devpod-linux-amd64"
  echo "$DEVPOD_SHA256  /tmp/devpod" | sha256sum -c --quiet
  install -m 0755 /tmp/devpod /usr/local/bin/devpod
  rm -f /tmp/devpod
fi

# The guest agent creates the user from the ssh-keys metadata; create it here
# too in case this runs first.
id toolbox >/dev/null 2>&1 || useradd -m -s /bin/bash toolbox
usermod -aG docker toolbox
su - toolbox -c 'devpod provider list --output json | jq -e ".docker" >/dev/null || devpod provider add docker'
touch "$READY"
