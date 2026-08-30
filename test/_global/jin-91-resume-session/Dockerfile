FROM ghcr.io/null-hype/devenv-linear-agent:sha-f68af4dfdc97bdcf97806f6c4bedc472ff565fac

# pass-cli's default key storage backend relies on the OS keyring
# (Secret Service over D-Bus), unavailable in this headless container.
# Baked into the image, not just set by the test script, so anything
# in this container that calls pass-cli gets the working key provider -
# not only jin-91-resume-session.sh.
ENV PROTON_PASS_KEY_PROVIDER="fs"

# SCENARIO_NAME: single source for this scenario's name, matching the
# jin-81-pass-cli/jin-90-dead-drop Dockerfiles' convention.
ARG SCENARIO_NAME=jin-91-resume-session

# Baked in at a known, absolute path so jin-91-resume-session.sh doesn't
# have to guess where the devcontainer CLI lands scenario files inside
# the running container.
COPY .env /opt/pass-cli/${SCENARIO_NAME}.env

# Restic/GCP secrets here are jin-81-pass-cli's, not a new JIN-91 vault
# item: restic repo/password/GCP creds are shared backup infra, not
# something this scenario needs its own copy of.
ENV PASS_CLI_ENV_FILE="/opt/pass-cli/${SCENARIO_NAME}.env"
