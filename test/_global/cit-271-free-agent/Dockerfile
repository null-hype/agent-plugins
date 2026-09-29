FROM ghcr.io/null-hype/devenv-linear-agent:sha-f68af4dfdc97bdcf97806f6c4bedc472ff565fac

# pass-cli's default key storage backend relies on the OS keyring (Secret
# Service over D-Bus), unavailable in this headless container. Same fs key
# provider the jin-90/jin-91 scenarios bake in.
ENV PROTON_PASS_KEY_PROVIDER="fs"

# Single source for this scenario family's name (all four hint-level scenarios
# share this one build context), matching the jin-* Dockerfiles' convention.
ARG SCENARIO_NAME=cit-271-free-agent

# Baked at known absolute paths so the scenario scripts don't have to guess
# where the devcontainer CLI lands files inside the running container.
COPY .env /opt/pass-cli/${SCENARIO_NAME}.env
COPY run-detector.sh state-positive.json state-control.json /opt/cit-271/
RUN chmod +x /opt/cit-271/run-detector.sh

# NOTE: this base image (devenv-linear-agent) wires Linear MCP. CIT-271 requires
# no Linear access; run-detector.sh enforces that at the claude invocation with
# --strict-mcp-config + an empty MCP config (belt) and --allowedTools= (braces).
# A Linear-free base (plain devenv-agent) would make it structural at the image
# layer too -- switch if one is published with claude + pass-cli bundled.

ENV PASS_CLI_ENV_FILE="/opt/pass-cli/${SCENARIO_NAME}.env"
