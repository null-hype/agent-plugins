#!/bin/sh
set -e

echo "Activating feature 'playwright-cli'"
echo "The requested @playwright/cli version is: ${VERSION}"
echo "The requested browser is: ${BROWSER}"

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

npm install -g "@playwright/cli@${VERSION}"

playwright-cli install-browser "${BROWSER}"

# Unlike pass-cli's skill (which needs a live, authenticated session that
# isn't available at image build time, so that one ships as a pre-baked
# static file - see src/pass-cli/install.sh), playwright-cli's own
# `install --skills` needs no auth, so it can just be run for real here.
#
# install.sh always runs as root, so plain `~` here would resolve to
# /root - a different home than whichever user actually invokes
# `playwright-cli` later. Use _REMOTE_USER_HOME so both agree on the
# same home directory, and chown the result so that user can actually
# read it when it isn't root.
TARGET_HOME="${_REMOTE_USER_HOME:-$HOME}"
HOME="$TARGET_HOME" playwright-cli install --skills --global
if [ -n "${_REMOTE_USER:-}" ]; then
    # Best-effort: ownership is a permissions nicety, not something that
    # should fail the whole feature install if _REMOTE_USER somehow
    # isn't a real system user yet at this point.
    chown -R "$_REMOTE_USER" "$TARGET_HOME/.claude" || true
fi
