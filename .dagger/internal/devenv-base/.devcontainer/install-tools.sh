#!/usr/bin/env bash
set -euo pipefail

if ! command -v claude >/dev/null 2>&1; then
  curl -fsSL https://claude.ai/install.sh | bash
fi

if ! command -v mise >/dev/null 2>&1; then
  curl -fsSL https://mise.run | sh
fi
export PATH="$HOME/.local/bin:$PATH"

# Activate mise (adds its shims to PATH) for this script's own use, and
# persist activation for future interactive shells (mise install alone
# doesn't put installed tools like hk on PATH).
eval "$(mise activate bash)"
if ! grep -q 'mise activate bash' "$HOME/.bashrc" 2>/dev/null; then
  echo 'eval "$(mise activate bash)"' >> "$HOME/.bashrc"
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
mise install --cd "$REPO_ROOT"

if ! command -v make >/dev/null 2>&1 || ! command -v tmux >/dev/null 2>&1 || ! command -v restic >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y make tmux restic
fi

if ! command -v linear-release >/dev/null 2>&1; then
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) LINEAR_RELEASE_ASSET=linear-release-linux-x64 ;;
    Darwin-arm64) LINEAR_RELEASE_ASSET=linear-release-darwin-arm64 ;;
    Darwin-x86_64) LINEAR_RELEASE_ASSET=linear-release-darwin-x64 ;;
    *) echo "install-tools.sh: no linear-release build for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
  esac
  curl -fsSL "https://github.com/linear/linear-release/releases/latest/download/${LINEAR_RELEASE_ASSET}" -o /tmp/linear-release
  chmod +x /tmp/linear-release
  sudo mv /tmp/linear-release /usr/local/bin/linear-release
fi

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
