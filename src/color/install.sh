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
# install.sh runs at image build time, before pass-cli is provisioned or
# authenticated (that happens later, at container runtime, once
# PROTON_PASS_PERSONAL_ACCESS_TOKEN is available). So this step is a
# no-op on every build except the agent image scenario, where the test
# script installs pass-cli, logs in, and then re-runs this same command
# itself once pass-cli is actually usable.
if command -v pass-cli >/dev/null 2>&1; then
    mkdir -p ~/.claude/skills/pass-cli
    pass-cli agent instructions > ~/.claude/skills/pass-cli/SKILL.md
else
    echo "pass-cli not present at build time; skipping pass-cli skill install"
fi


chmod +x /usr/local/bin/color
