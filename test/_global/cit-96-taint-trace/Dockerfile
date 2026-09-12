FROM ghcr.io/null-hype/devenv-linear-agent:sha-f68af4dfdc97bdcf97806f6c4bedc472ff565fac

# pass-cli's default key storage backend relies on the OS keyring (Secret
# Service over D-Bus), unavailable in this headless container. Baked into
# the image, same as jin-81-pass-cli's Dockerfile, so anything in this
# container that calls pass-cli gets the working key provider.
ENV PROTON_PASS_KEY_PROVIDER="fs"

# This scenario asserts real-CLI-captured Pkl facts (pkl/Scope.pkl,
# pkl/Scope.test.pkl), which the base image doesn't carry -- jq and
# pass-cli are already present there, pkl is not.
RUN curl https://mise.run | sh \
    && /root/.local/bin/mise use -g pkl@0.28.2
ENV PATH="/root/.local/bin:${PATH}"

# `devcontainer features test` does not live-mount the repo into the test
# container the way a normal `devcontainer up` mounts the workspace --
# confirmed live (a runtime `find` for the repo tree came up empty). So the
# schema/facts/fail-closed-check this scenario asserts against are baked in
# at build time instead, from this scenario's build context (repo root, see
# this scenario's "context" in scenarios.json) -- same single source of
# truth as the offline hk-check path, just copied rather than live-read.
COPY .dagger/internal/devenv-base/pkl/Scope.pkl .dagger/internal/devenv-base/pkl/Scope.test.pkl /opt/cit-96/pkl/
COPY .dagger/internal/devenv-base/hk/check-taint-trace-fail-closed.sh /opt/cit-96/hk/
