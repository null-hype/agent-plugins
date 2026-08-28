FROM ghcr.io/null-hype/devenv-linear-agent:sha-f68af4dfdc97bdcf97806f6c4bedc472ff565fac

# pass-cli's default key storage backend relies on the OS keyring
# (Secret Service over D-Bus), unavailable in this headless container.
# Baked into the image, not just set by the test script, so anything
# in this container that calls pass-cli gets the working key provider -
# not only jin-81.sh.
ENV PROTON_PASS_KEY_PROVIDER="fs"

# SCENARIO_NAME and VAULT_NAME: single source for values otherwise
# repeated across this file and .env. Docker build ARGs and
# devcontainer feature options are separate mechanisms with no way to
# reference each other, so SCENARIO_NAME here still has to be kept in
# sync by hand with the 'color' feature's "tag" option in
# scenarios.json - but VAULT_NAME (the part expected to change, e.g.
# if the vault gets renamed) now only needs updating in one place
# (scenarios.json's build.args), instead of by hand in a static .env
# file.
ARG SCENARIO_NAME=jin-81
ARG VAULT_NAME=JIN-81

# Generated (not a static checked-in .env) so renaming the vault is a
# one-line change to VAULT_NAME rather than editing every pass:// URI.
RUN mkdir -p /opt/pass-cli && \
    { \
        echo "CLAUDE_CODE_OAUTH_TOKEN=pass://${VAULT_NAME}/claude/CLAUDE_CODE_OAUTH_TOKEN"; \
        echo "GCP_SERVICE_ACCOUNT_KEY=pass://${VAULT_NAME}/restic/GCP_SERVICE_ACCOUNT_KEY"; \
        echo "GOOGLE_PROJECT_ID=pass://${VAULT_NAME}/restic/GOOGLE_PROJECT_ID"; \
        echo "RESTIC_REPOSITORY=pass://${VAULT_NAME}/restic/RESTIC_REPOSITORY"; \
        echo "RESTIC_PASSWORD=pass://${VAULT_NAME}/restic/RESTIC_PASSWORD"; \
    } > "/opt/pass-cli/${SCENARIO_NAME}.env"

# Picked up by the 'color' feature bin's own pass-cli/claude/restic
# block (see src/color/install.sh) so invoking `color` in this scenario
# exercises the pass-cli skill and restic snapshot automatically.
ENV PASS_CLI_ENV_FILE="/opt/pass-cli/${SCENARIO_NAME}.env"
