#!/bin/sh
set -e

echo "Activating feature 'color'"
echo "The provided favorite color is: ${FAVORITE}"


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

cat > /usr/local/bin/color \
<< EOF
#!/bin/sh
echo "my favorite color is ${FAVORITE}"

# If pass-cli is on PATH, configured (PASS_CLI_ENV_FILE set - baked into
# the image by scenarios that want this), and already logged in, also
# ask claude something and snapshot this session's transcript to restic.
# The live-login check means this is safe to leave enabled unconditionally:
# a caller who hasn't logged in (or doesn't have pass-cli at all) just
# gets the plain favorite-color line, same as before.
if [ -n "\${PASS_CLI_ENV_FILE:-}" ] && command -v pass-cli >/dev/null 2>&1 && pass-cli info >/dev/null 2>&1; then
    pass-cli run --env-file "\$PASS_CLI_ENV_FILE" -- claude -p --model ${MODEL} --effort ${EFFORT} "What is your favorite color? Also list the names of any skills you currently have available, one per line."

    # The GCS backend restic uses wants GOOGLE_APPLICATION_CREDENTIALS
    # pointing at a key *file*, not the inline JSON pass-cli resolves
    # into GCP_SERVICE_ACCOUNT_KEY, so materialize that first.
    pass-cli run --env-file "\$PASS_CLI_ENV_FILE" -- sh -c '
        set -e
        export GOOGLE_APPLICATION_CREDENTIALS="/tmp/gcp-service-account.json"
        printf %s "\$GCP_SERVICE_ACCOUNT_KEY" > "\$GOOGLE_APPLICATION_CREDENTIALS"
        restic backup ~/.claude --tag ${TAG}
    '
fi
EOF


# Install the pass-cli skill so claude knows how to use pass-cli itself
# for any future task, rather than us documenting usage by hand.
#
# `pass-cli agent instructions` needs an authenticated session, which
# isn't available (and shouldn't be baked into the image) at build
# time. So instead of calling pass-cli live, ship its output as a
# static file (regenerated with `make` on a machine with a real
# session) and just install that.
#
# install.sh always runs as root, so plain `~` here would resolve to
# /root - a different home than whichever user actually invokes
# `color` later (and whose `~/.claude` the generated bin's restic
# backup targets at runtime). Use _REMOTE_USER_HOME so both agree on
# the same home directory, and chown the result so that user can
# actually read it when it isn't root.
TARGET_HOME="${_REMOTE_USER_HOME:-$HOME}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$TARGET_HOME/.claude/skills/pass-cli"
cp "$SCRIPT_DIR/.claude/skills/pass-cli/SKILL.md" "$TARGET_HOME/.claude/skills/pass-cli/SKILL.md"
if [ -n "${_REMOTE_USER:-}" ]; then
    # Best-effort: ownership is a permissions nicety, not something that
    # should fail the whole feature install if _REMOTE_USER somehow
    # isn't a real system user yet at this point.
    chown -R "$_REMOTE_USER" "$TARGET_HOME/.claude" || true
fi


chmod +x /usr/local/bin/color
