#!/usr/bin/env bash
# Render's build command for the supervisor workflow (CIT-472). Render's Node
# runtime has no pass-cli, so the build installs it into ./bin, which is kept
# for the run: the Proton Pass token is the only secret the service holds,
# and render-start.sh resolves everything else from Pass at run time.
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

