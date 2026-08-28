FROM ghcr.io/null-hype/devenv-linear-agent:sha-f68af4dfdc97bdcf97806f6c4bedc472ff565fac

# Baked in at a known, absolute path so jin-81.sh doesn't have to guess
# where the devcontainer CLI lands scenario files inside the running
# container.
COPY .env /opt/pass-cli/jin-81.env
