#!/usr/bin/env bash
# GCE startup script for the toolbox host (Debian 12). It runs as root on
# every boot and is idempotent: it installs Docker, jq and git, the pinned
# DevPod CLI, and DevPod's docker provider for the toolbox user. It
# touches $READY last; host_status reports ready only once it exists.
set -euo pipefail

READY=/var/lib/toolbox-host.ready
rm -f "$READY"

DEVPOD_VERSION=v0.6.15
# Upstream publishes no checksums; this is the release asset's sha256.
DEVPOD_SHA256=cc50bce09229d5a6d448ac1d4494327f4b8f7a20321e5fcee3bfec1aef0d20c5

if ! command -v docker >/dev/null || ! command -v jq >/dev/null; then
  apt-get update
  apt-get install -y docker.io jq git curl
fi

if ! echo "$DEVPOD_SHA256  /usr/local/bin/devpod" | sha256sum -c --quiet 2>/dev/null; then
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
