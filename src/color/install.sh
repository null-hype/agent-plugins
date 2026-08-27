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
EOF


# Install the pass-cli skill so claude knows how to use pass-cli itself
# for any future task, rather than us documenting usage by hand.
#
# `pass-cli agent instructions` needs an authenticated session, which
# isn't available (and shouldn't be baked into the image) at build
# time. So instead of calling pass-cli live, ship its output as a
# static file (regenerated with `make` on a machine with a real
# session) and just install that.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p ~/.claude/skills/pass-cli
cp "$SCRIPT_DIR/.claude/skills/pass-cli/SKILL.md" ~/.claude/skills/pass-cli/SKILL.md


chmod +x /usr/local/bin/color
