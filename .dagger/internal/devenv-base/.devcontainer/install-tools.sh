#!/usr/bin/env bash
set -euo pipefail

# claude, mise (the binary), make, tmux, restic and linear-release are baked
# into the image at build time now (LinearAgent in main.go -- JIN-129).
# What's left here is environment-dependent and can't be resolved at
# image-build time: activating mise for this shell/future ones, installing
# this repo's pinned tool versions against the live checkout, wiring git
# hooks (.git/hooks isn't tracked by git, so this needs to run on every
# fresh clone/container), and the docker-socket-GID dance below.

# Activate mise (adds its shims to PATH) for this script's own use, and
# persist activation for future interactive shells (mise install alone
# doesn't put installed tools like hk on PATH).
eval "$(mise activate bash)"
if ! grep -q 'mise activate bash' "$HOME/.bashrc" 2>/dev/null; then
  echo 'eval "$(mise activate bash)"' >> "$HOME/.bashrc"
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
mise install --cd "$REPO_ROOT"

# mise install only puts binaries on PATH; it doesn't wire git hooks, and
# .git/hooks isn't tracked by git, so this needs to run on every fresh
# clone/container (a rebuild counts as fresh -- past manual `hk install`
# runs don't survive it).
(cd "$REPO_ROOT" && hk install)

# hk install generates hooks that invoke the bare `hk` command, resolved via
# PATH at hook-run time. mise only puts hk on PATH for interactive shells
# that source ~/.bashrc (see the activation block above) -- so any process
# that pushes to this repo with a different/minimal PATH (e.g. container-use
# mirroring the repo into its internal store before starting an environment)
# fails hook execution with "exec: hk: not found" and the push never
# completes. Rewrite the generated hook scripts to call hk by absolute path
# so they work regardless of the invoking process's PATH. (JIN-125)
HK_BIN="$(command -v hk)"
for hook in "$REPO_ROOT"/.git/hooks/pre-commit "$REPO_ROOT"/.git/hooks/pre-push; do
  [ -f "$hook" ] || continue
  sed -i "s#exec hk #exec \"$HK_BIN\" #" "$hook"
done

#
# docker-outside-of-docker's feature install normally syncs the container's
# local "docker" group to whatever GID actually owns the host's docker
# socket, then adds remoteUser to it -- but that sync runs from the
# feature's container ENTRYPOINT (/usr/local/share/docker-init.sh), and
# devpod's GCE provider overwrites that file with a no-op stub (`exec
# "$@"`), since it wires up /var/run/docker.sock (a symlink to
# /var/run/docker-host.sock) itself. The container's baked-in "docker"
# group (gid 101) is therefore unrelated to the group that actually owns
# the socket -- observed live: docker-host.sock's group was gid 412, which
# has no name at all inside the container (`getent group 412` empty), so
# adding vscode to the local "docker" group left every docker call
# permission-denied, including the container-use MCP subprocess
# linear-agent spawns, which then hangs/fails every real agent session with
# no visible error. Resolving the actual owning GID at runtime (rather than
# assuming "docker"/101) and creating/joining a group for it is what
# docker-init.sh would have done. Group changes need a new login session to
# take effect, which every `devpod ssh --command` invocation already is, so
# this just needs to run once per boot before start-linear-agent.sh.
DOCKER_SOCK_GID=$(stat -L -c %g /var/run/docker.sock 2>/dev/null || true)
if [ -n "$DOCKER_SOCK_GID" ]; then
  DOCKER_SOCK_GROUP=$(getent group "$DOCKER_SOCK_GID" | cut -d: -f1 || true)
  if [ -z "$DOCKER_SOCK_GROUP" ]; then
    DOCKER_SOCK_GROUP=docker-host
    sudo groupadd -g "$DOCKER_SOCK_GID" "$DOCKER_SOCK_GROUP"
  fi
  if ! id -nG vscode | grep -qw "$DOCKER_SOCK_GROUP"; then
    sudo usermod -aG "$DOCKER_SOCK_GROUP" vscode
  fi
fi
