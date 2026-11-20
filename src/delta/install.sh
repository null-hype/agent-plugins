#!/bin/bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends bash ca-certificates curl python3 tar util-linux

# Install once for every user. DevPod builds Features with _REMOTE_USER=root
# even when remoteUser is set, so nothing here may depend on the remote user:
# the start hook links that user's data directory when the container starts.
prefix=/usr/local/share/delta
installer=$(mktemp)
trap 'rm -f "$installer"' EXIT
curl -fsSL https://delta.dev/install.sh -o "$installer"
mkdir -p "$prefix"
HOME="$prefix" sh "$installer" --non-interactive
chmod -R a+rX "$prefix"
ln -sf "$prefix/.local/bin/delta" /usr/local/bin/delta
delta --version

# A fixed mount target works for any remote user's home.
mkdir -p /var/lib/delta /usr/local/etc
printf '%s\n' "${RUNNER:-false}" > /usr/local/etc/delta-runner-enabled
printf '%s\n' "${RUNNERNAME:-delta-workspace}" > /usr/local/etc/delta-runner-name
install -m 755 "$(dirname "$0")/delta-runner-start" /usr/local/bin/delta-runner-start
