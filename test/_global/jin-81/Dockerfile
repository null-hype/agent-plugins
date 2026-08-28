FROM ghcr.io/null-hype/devenv-linear-agent:sha-f68af4dfdc97bdcf97806f6c4bedc472ff565fac

# pass-cli's default key storage backend relies on the OS keyring
# (Secret Service over D-Bus), unavailable in this headless container.
# Baked into the image, not just set by the test script, so anything
# in this container that calls pass-cli gets the working key provider -
# not only jin-81.sh.
ENV PROTON_PASS_KEY_PROVIDER="fs"

# SCENARIO_NAME: single source for this scenario's name, instead of
# hardcoding "jin-81" separately in the .env path below and (previously)
# in a RESTIC_TAG env var - the restic tag now comes from the 'color'
# feature's own "tag" option in scenarios.json instead, matching this
# same name by convention.
ARG SCENARIO_NAME=jin-81

# Baked in at a known, absolute path so jin-81.sh doesn't have to guess
# where the devcontainer CLI lands scenario files inside the running
# container.
COPY .env /opt/pass-cli/${SCENARIO_NAME}.env

# Picked up by the 'color' feature bin's own pass-cli/claude/restic
# block (see src/color/install.sh) so invoking `color` in this scenario
# exercises the pass-cli skill and restic snapshot automatically.
ENV PASS_CLI_ENV_FILE="/opt/pass-cli/${SCENARIO_NAME}.env"
