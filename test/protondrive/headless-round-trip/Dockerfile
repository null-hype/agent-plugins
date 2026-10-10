FROM mcr.microsoft.com/devcontainers/base:ubuntu

# restic is the scenario's fixture, not part of the protondrive feature:
# it produces the snapshot the scenario uploads and lists back.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends restic jq \
    && rm -rf /var/lib/apt/lists/*
