#!/usr/bin/env bash
# Render's build command for the supervisor workflow (CIT-472). Render's Node
# runtime has no pass-cli and no Claude Code, so the build installs both into
# ./bin, which is kept for the run: the Proton Pass token is the only secret
# the service holds, and render-start.sh resolves everything else from Pass
# at run time. `execute` runs claude from there.
set -euo pipefail
npm ci --no-audit --no-fund
npm run build
mkdir -p bin
if ! command -v pass-cli > /dev/null; then
  curl -fsSL https://proton.me/download/pass-cli/install.sh | bash
fi
# The installer puts it in ~/.local/bin, which is not on the build's PATH.
found=""
for p in "$(command -v pass-cli || true)" "$HOME/.local/bin/pass-cli" /usr/local/bin/pass-cli; do
  if [ -n "$p" ] && [ -x "$p" ]; then
    found=$p
    break
  fi
done
[ -n "$found" ] || { echo "render-build: pass-cli did not install" >&2; exit 1; }
cp "$found" bin/pass-cli
bin/pass-cli --version

# Claude Code, the native build, as the supervisor image installs it. The
# installer links ~/.local/bin/claude to a versioned binary; copy the binary.
if [ ! -x "$HOME/.local/bin/claude" ]; then
  curl -fsSL https://claude.ai/install.sh | bash
fi
[ -x "$HOME/.local/bin/claude" ] || { echo "render-build: claude did not install" >&2; exit 1; }
cp -L "$HOME/.local/bin/claude" bin/claude
bin/claude --version
