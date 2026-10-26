import { test } from './fixtures';

// A node of our plan: install the language server and its editor setup with one
// dev container feature. Each step is one change: one small repoless Jules
// session that knows only what that change needs. The judge then
// asks Jev whether the file does what the step asked.
const MODULE = 'github.com/null-hype/agent-plugins/jev-playwright/lsp';

test('Can one dev container feature install jev-lsp and its Neovim setup?', async ({ plan, hunk }) => {
  test.setTimeout(60 * 60_000);

  await plan('Write a dev container feature that installs jev-lsp and its Neovim setup');
  if (test.info().project.metadata.planOnly) return;

  await test.step("Write the feature's manifest", () => hunk('src/jev-lsp/devcontainer-feature.json', `
Write a dev container feature manifest (devcontainer-feature.json) for a feature with id
"jev-lsp", version "0.1.0", named "jev-lsp (Jev answers as diagnostics)". It installs a Go
language server and its Neovim setup. One string option, "version", default "latest": the
version of the Go module ${MODULE} to install. It depends on
ghcr.io/devcontainers/features/go:1.`));

  await test.step('Write the install script', () => hunk('src/jev-lsp/install.sh', `
Write install.sh for a dev container feature, POSIX sh with set -e. It runs as root, after
Go is installed, with the option VERSION in the environment.

1. Install the Go module ${MODULE} at VERSION with go install. The binary go builds is
   named "lsp"; install it as /usr/local/bin/jev-lsp.
2. The module ships a Neovim setup at nvim/jev.lua. Find the module's directory with
   go mod download -json ${MODULE}@VERSION (its "Dir" field) and copy that file to
   \${_REMOTE_USER_HOME}/.config/nvim/plugin/jev.lua, so Neovim loads it at start.
3. Give that user ownership of what was created under their home (_REMOTE_USER).`));

  await test.step("Write the feature's test", () => hunk('test/jev-lsp/test.sh', `
Write test/jev-lsp/test.sh, a test for a dev container feature named jev-lsp, in the
devcontainers/cli features test format: bash, set -e, source dev-container-features-test-lib,
one "check" per claim, then reportResults. Check that:

1. jev-lsp is on the PATH.
2. ~/.config/nvim/plugin/jev.lua exists.
3. jev-lsp answers an LSP initialize request over stdio: send one Content-Length framed
   initialize request and expect a response containing "capabilities".`));
});
