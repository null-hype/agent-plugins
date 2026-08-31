#!/bin/sh
set -e

echo "Activating feature 'devpod'"

# The 'install.sh' entrypoint script is always executed as the root user.
#
# These following environment variables are passed in by the dev container CLI.
# These may be useful in instances where the context of the final
# remoteUser or containerUser is useful.
# For more details, see https://containers.dev/implementors/features#user-env-var
echo "The effective dev container remoteUser is '$_REMOTE_USER'"
echo "The effective dev container remoteUser's home directory is '$_REMOTE_USER_HOME'"

echo "The effective dev container containerUser is '$_CONTAINER_USER'"
echo "The effective dev container containerUser's home directory is '$_CONTAINER_USER_HOME'"

# install.sh always runs as root, so plain `~` here would resolve to /root,
# not the workspace/remote user devpod-gce.sh and friends run as. Use
# _REMOTE_USER_HOME so this agrees with whoever actually calls
# `pass-cli run --env-file .agent/skills/devpod/.env --`.
TARGET_HOME="${_REMOTE_USER_HOME:-$HOME}"

# One vault item, one fixed path -- no vault-path option. pass:// references
# only; no secret values ever land in this file or in the feature source.
mkdir -p "$TARGET_HOME/.agent/skills/devpod"
cat > "$TARGET_HOME/.agent/skills/devpod/.env" << 'EOF'
GCP_SERVICE_ACCOUNT_KEY=pass://JIN-63/restic/GCP_SERVICE_ACCOUNT_KEY
GOOGLE_PROJECT_ID=pass://JIN-63/restic/GOOGLE_PROJECT_ID
RESTIC_REPOSITORY=pass://JIN-63/restic/RESTIC_REPOSITORY
RESTIC_PASSWORD=pass://JIN-63/restic/RESTIC_PASSWORD
GITHUB_TOKEN=pass://JIN-63/gh/GITHUB_TOKEN
EOF

if [ -n "${_REMOTE_USER:-}" ]; then
    # Best-effort: ownership is a permissions nicety, not something that
    # should fail the whole feature install if _REMOTE_USER somehow isn't
    # a real system user yet at this point.
    chown -R "$_REMOTE_USER" "$TARGET_HOME/.agent" || true
fi
