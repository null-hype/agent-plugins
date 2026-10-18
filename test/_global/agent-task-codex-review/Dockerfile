# The checkout the agent-task works in: one small script, one commit.
FROM ghcr.io/null-hype/devenv-linear-agent:sha-98bb9d0befe29b494c466418b6c1a9d0e55d7ccd
COPY count-lines.sh /work/repo/count-lines.sh
RUN cd /work/repo && chmod +x count-lines.sh \
    && git init -q && git config user.email agent@example.com && git config user.name agent \
    && git remote add origin https://github.com/example/count-lines.git \
    && git add . && git commit -qm "count-lines: per-file line counts"
