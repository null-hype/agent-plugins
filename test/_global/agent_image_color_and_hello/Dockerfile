FROM ghcr.io/null-hype/devenv-linear-agent:sha-7ff1019c7882c9bfcf0948ab96ef0a4efad528c7

# Baked in at a known, absolute path so agent_image_color_and_hello.sh
# doesn't have to guess where the devcontainer CLI lands scenario files
# inside the running container.
COPY .env /opt/pass-cli/agent_image_color_and_hello.env
