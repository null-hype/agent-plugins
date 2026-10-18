#!/usr/bin/env bash
# GCE startup script for the toolbox host (Debian 12). It runs as root on
# every boot and is idempotent: it installs Docker, jq and git, Tailscale,
# the pinned Codex, container-use and DevPod CLIs, and DevPod's docker
# provider for the toolbox user. It touches $READY last; host_status reports
# ready only once it exists.
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
# Codex runs every tool through codex-code-mode-host, a separate asset.
CODEX_VERSION=0.163.0
CODEX_SHA256=beb339e8ecd9ba057a6bb2dc81ad8ca474812edfbf0fc5056ca818797648dde4
CODEX_MODE_HOST_SHA256=314263128ba6592e7e807c265deeaf928a692b72dcbfeb5e0b20c9423b703529
install_codex_asset() {
  local name=$1 sha=$2 f=$1-x86_64-unknown-linux-musl
  curl -fsSL -o "/tmp/$f.tgz" "https://github.com/openai/codex/releases/download/rust-v$CODEX_VERSION/$f.tar.gz"
  echo "$sha  /tmp/$f.tgz" | sha256sum -c --quiet
  tar -xzf "/tmp/$f.tgz" -C /tmp "$f"
  install -m 0755 "/tmp/$f" "/usr/local/bin/$name"
  rm -f "/tmp/$f.tgz" "/tmp/$f"
}
if [ "$(codex --version 2>/dev/null)" != "codex-cli $CODEX_VERSION" ]; then
  install_codex_asset codex "$CODEX_SHA256"
  install_codex_asset codex-code-mode-host "$CODEX_MODE_HOST_SHA256"
fi
[ -x /usr/local/bin/codex-code-mode-host ] || install_codex_asset codex-code-mode-host "$CODEX_MODE_HOST_SHA256"

# container-use, as in the devcontainer: Codex creates an environment per
# review finding.
CONTAINER_USE_VERSION=0.4.2
if [ "$(container-use version 2>/dev/null | awk '{print $NF}' | tr -d v | head -1)" != "$CONTAINER_USE_VERSION" ]; then
  f=container-use_v${CONTAINER_USE_VERSION}_linux_amd64.tar.gz
  d=$(mktemp -d)
  curl -fsSL -o "$d/$f" "https://github.com/dagger/container-use/releases/download/v$CONTAINER_USE_VERSION/$f"
  curl -fsSL -o "$d/checksums.txt" "https://github.com/dagger/container-use/releases/download/v$CONTAINER_USE_VERSION/checksums.txt"
  (cd "$d" && grep " $f\$" checksums.txt | sha256sum -c --quiet && tar -xzf "$f" container-use)
  install -m 0755 "$d/container-use" /usr/local/bin/container-use
  rm -rf "$d"
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
