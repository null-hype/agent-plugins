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
# `pass-cli agent instructions` doesn't require authentication, so this
# works at image build time as long as pass-cli itself is already on
# PATH. The color feature is tested exclusively against images that
# bundle pass-cli (see the devenv-agent-based images in test.yaml and
# test/color/scenarios.json) precisely so this can run unconditionally.
mkdir -p ~/.claude/skills/pass-cli
pass-cli agent instructions > ~/.claude/skills/pass-cli/SKILL.md


chmod +x /usr/local/bin/color
