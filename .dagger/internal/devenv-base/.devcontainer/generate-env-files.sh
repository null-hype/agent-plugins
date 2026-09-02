#!/usr/bin/env bash
# Regenerates the gitignored `.env` files (tailscale.env, gcloud.env,
# linear-release.env -- see hk/generate-env-files.sh) from
# pkl/EnvTemplates.pkl. Runs first in gce_common_bootstrap_steps, ahead of
# tailscale-up.sh/RecreateDevpod's own read of gcloud.env, since a fresh
# `devpod up --source git:...` clone never carries these gitignored files.
# Installs pkl via mise if it isn't already on PATH (mirrors the
# mise-bootstrap in install-tools.sh, which itself runs later in the
# bootstrap sequence and so can't be relied on to have run yet).
set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v pkl >/dev/null 2>&1; then
  if ! command -v mise >/dev/null 2>&1; then
    curl -fsSL https://mise.run | sh
  fi
  export PATH="$HOME/.local/bin:$PATH"
  eval "$(mise activate bash)"
  mise install --cd "$MODULE_DIR"
fi

exec bash "$MODULE_DIR/hk/generate-env-files.sh"
