FROM ghcr.io/null-hype/devenv-linear-agent:sha-f68af4dfdc97bdcf97806f6c4bedc472ff565fac

# pass-cli's default key storage backend relies on the OS keyring
# (Secret Service over D-Bus), unavailable in this headless container.
# Baked into the image, not just set by the test script, so anything
# in this container that calls pass-cli gets the working key provider -
# not only jin-91-resume-session.sh.
ENV PROTON_PASS_KEY_PROVIDER="fs"

# SCENARIO_NAME: single source for this scenario's name, matching the
# jin-81-pass-cli/jin-90-dead-drop Dockerfiles' convention. Also kept
# equal, by convention rather than any automatic derivation devcontainer
# features support, to the "tag" option this scenario passes the
# pass-cli feature in scenarios.json - that value becomes both the
# restic tag AND the AGENT_ASSIGNMENT the 'color' bin uses internally
# (see src/pass-cli/install.sh), so all three - SCENARIO_NAME,
# RESTIC_TAG, AGENT_ASSIGNMENT - read the same string.
ARG SCENARIO_NAME=jin-91-resume-session

# Baked in at a known, absolute path so jin-91-resume-session.sh doesn't
# have to guess where the devcontainer CLI lands scenario files inside
# the running container.
COPY .env /opt/pass-cli/${SCENARIO_NAME}.env

# This scenario's .env has no vault item of its own: the claude token
# comes from the shared 'anthropic.ai' vault (one token, many scenarios)
# and the restic/GCP secrets come from JIN-81's restic vault (shared
# backup infra) - both referenced, not duplicated.
ENV PASS_CLI_ENV_FILE="/opt/pass-cli/${SCENARIO_NAME}.env"
