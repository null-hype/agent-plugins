FROM ghcr.io/null-hype/devenv-linear-agent:sha-375042cf0a7ac6a302438a0e62827c457f5e0d1c

# The shared agent image is still on Debian 12 (glibc 2.36), which cannot
# start the Delta CLI. Upgrade only the internal Codespaces image, at build
# time, retaining the agent image's tools and leaving the GCE base alone.
# NodeSource and Cloud SDK use distro-independent suites; Tailscale does not.
RUN set -eux; \
    . /etc/os-release; \
    test "$VERSION_CODENAME" = bookworm; \
    sed -i 's/bookworm/trixie/g' /etc/apt/sources.list.d/debian.sources /etc/apt/sources.list.d/tailscale.list; \
    apt-get update; \
    export DEBIAN_FRONTEND=noninteractive; \
    apt-get upgrade -y; \
    apt-get dist-upgrade -y; \
    . /etc/os-release; \
    test "$VERSION_CODENAME" = trixie; \
    node --version; \
    tailscale version; \
    gcloud --version; \
    rm -rf /var/lib/apt/lists/*
