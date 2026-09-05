FROM ghcr.io/null-hype/devenv-linear-agent:sha-f68af4dfdc97bdcf97806f6c4bedc472ff565fac

# pass-cli's default key storage backend relies on the OS keyring
# (Secret Service over D-Bus), unavailable in this headless container.
# Baked into the image, not just set by the test script, so anything
# in this container that calls pass-cli gets the working key provider -
# not only cit-16-create-subagent.sh.
ENV PROTON_PASS_KEY_PROVIDER="fs"

# SCENARIO_NAME: single source for this scenario's name, matching the
# jin-81-pass-cli Dockerfile's convention.
ARG SCENARIO_NAME=cit-16-create-subagent

# Baked in at a known, absolute path so cit-16-create-subagent.sh doesn't
# have to guess where the devcontainer CLI lands scenario files inside the
# running container.
COPY .env /opt/pass-cli/${SCENARIO_NAME}.env

# Only CLAUDE_CODE_OAUTH_TOKEN lives in this scenario's env file - like
# jin-90-dead-drop, this scenario never calls the 'color' bin's own
# restic-backup block, so it has no use for the restic/GCP secrets that
# file also carries.
ENV PASS_CLI_ENV_FILE="/opt/pass-cli/${SCENARIO_NAME}.env"
