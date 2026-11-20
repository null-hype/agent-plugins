#!/bin/bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends bash ca-certificates curl python3 tar util-linux

user=${_REMOTE_USER:-root}
# common-utils may create the remote user after the CLI captures its built-in
# home variable. Resolve the account now, after that Feature has run.
home=$(getent passwd "$user" | cut -d: -f6)
: "${home:?Remote user has no home directory}"
installer=$(mktemp)
trap 'rm -f "$installer"' EXIT
curl -fsSL https://delta.dev/install.sh -o "$installer"
chmod 644 "$installer"
su -s /bin/bash "$user" -c "HOME='$home' sh '$installer' --non-interactive"
ln -sf "$home/.local/bin/delta" /usr/local/bin/delta
delta --version

# A fixed mount target works for any remote user's home. Docker initializes
# a new named volume from this directory, including its ownership.
mkdir -p /var/lib/delta "$home/.local/share" /usr/local/etc
chown "$user:$(id -gn "$user")" /var/lib/delta "$home/.local/share"
if [ -e "$home/.local/share/delta" ]; then
    echo "Delta data already exists at $home/.local/share/delta; refusing to replace it." >&2
    exit 1
fi
ln -s /var/lib/delta "$home/.local/share/delta"
printf '%s\n' "${RUNNER:-false}" > /usr/local/etc/delta-runner-enabled
printf '%s\n' "${RUNNERNAME:-delta-workspace}" > /usr/local/etc/delta-runner-name
install -m 755 "$(dirname "$0")/delta-runner-start" /usr/local/bin/delta-runner-start
