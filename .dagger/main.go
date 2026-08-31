// A Dagger module for testing agent-plugins' devcontainer and tooling setup,
// and for building/publishing the shared base images the always-on
// dev/agent environments layer onto (ported from devenv-base — JIN-104).
package main

import (
	"context"
	"fmt"

	"dagger/agent-plugins/internal/dagger"
)

const devcontainerImage = "mcr.microsoft.com/devcontainers/javascript-node:1-20-bookworm"

// playwrightVersion pins the npm package so image builds are reproducible.
const playwrightVersion = "1.62.1"

type AgentPlugins struct{}

// ---------------------------------------------------------------------------
// Image builds (Base/Publish/CheckBase family), ported from devenv-base
// (JIN-104). devenv-base's own install-layer dedup (JIN-103) hasn't landed
// yet, so these are ported pragmatically as-is rather than refactored here.

// Base returns the shared bookworm-slim base image all capabilities layer
// onto. platform defaults to the host/engine platform if omitted; Publish
// pins it explicitly per architecture to build a multi-platform image.
func (m *AgentPlugins) Base(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	return dag.Container(dagger.ContainerOpts{Platform: platform}).From("debian:bookworm-slim")
}

// publishImage pushes the given platform variants to
// ghcr.io/null-hype/<image>:<tag>, authenticating with the given GitHub
// username/token. Shared by the exported Publish* functions, one per image
// this module ships.
func publishImage(
	ctx context.Context,
	image string,
	tag string,
	githubUser string,
	githubToken *dagger.Secret,
	variants []*dagger.Container,
) (string, error) {
	return dag.Container().
		WithRegistryAuth("ghcr.io", githubUser, githubToken).
		Publish(ctx, fmt.Sprintf("ghcr.io/null-hype/%s:%s", image, tag), dagger.ContainerPublishOpts{
			PlatformVariants: variants,
		})
}

// Publish pushes a multi-platform (amd64 + arm64) image to
// ghcr.io/null-hype/agent-plugins-base:<tag>, authenticating with the given
// GitHub username/token.
func (m *AgentPlugins) Publish(
	ctx context.Context,
	tag string,
	githubUser string,
	githubToken *dagger.Secret,
) (string, error) {
	return publishImage(ctx, "agent-plugins-base", tag, githubUser, githubToken, []*dagger.Container{
		m.Base("linux/amd64"),
		m.Base("linux/arm64"),
	})
}

// PublishPlaywright pushes the slim Playwright image to
// ghcr.io/null-hype/agent-plugins-playwright:<tag>. amd64 only: an arm64
// variant would run playwright install --with-deps under QEMU emulation on
// GitHub's amd64 runners, for a browser box nothing currently pulls on
// arm64.
func (m *AgentPlugins) PublishPlaywright(
	ctx context.Context,
	tag string,
	githubUser string,
	githubToken *dagger.Secret,
) (string, error) {
	return publishImage(ctx, "agent-plugins-playwright", tag, githubUser, githubToken, []*dagger.Container{
		m.Playwright("linux/amd64"),
	})
}

// PublishAgent pushes the slim Agent image (container-use, Claude Code) to
// ghcr.io/null-hype/agent-plugins-agent:<tag>. amd64 only, matching where
// this image actually runs.
func (m *AgentPlugins) PublishAgent(
	ctx context.Context,
	tag string,
	githubUser string,
	githubToken *dagger.Secret,
) (string, error) {
	return publishImage(ctx, "agent-plugins-agent", tag, githubUser, githubToken, []*dagger.Container{
		m.Agent("linux/amd64"),
	})
}

// PublishPlaywrightAgent pushes the PlaywrightAgent image (git, gh,
// Playwright+Chromium, Claude Code) to
// ghcr.io/null-hype/agent-plugins-playwright-agent:<tag>. amd64 only,
// matching Agent and Playwright.
func (m *AgentPlugins) PublishPlaywrightAgent(
	ctx context.Context,
	tag string,
	githubUser string,
	githubToken *dagger.Secret,
) (string, error) {
	return publishImage(ctx, "agent-plugins-playwright-agent", tag, githubUser, githubToken, []*dagger.Container{
		m.PlaywrightAgent("linux/amd64"),
	})
}

// CheckBase asserts the base image is the expected Debian release.
// +check
func (m *AgentPlugins) CheckBase(ctx context.Context) error {
	out, err := m.Base("").
		WithExec([]string{"sh", "-c", "grep VERSION_CODENAME /etc/os-release"}).
		Stdout(ctx)
	if err != nil {
		return err
	}
	return assertContains(out, "bookworm")
}

// withAptPackages runs apt-get update, installs pkgs with
// --no-install-recommends, and drops the package list cache in one exec.
func withAptPackages(c *dagger.Container, pkgs ...string) *dagger.Container {
	c = c.WithExec([]string{"apt-get", "update"})
	c = c.WithExec(append([]string{"apt-get", "install", "-y", "--no-install-recommends"}, pkgs...))
	return c.WithExec([]string{"sh", "-c", "rm -rf /var/lib/apt/lists/*"})
}

// withPassCli installs the Proton Pass CLI onto c.
func withPassCli(c *dagger.Container) *dagger.Container {
	return withAptPackages(c, "curl", "ca-certificates", "jq").
		WithEnvVariable("PROTON_PASS_CLI_INSTALL_DIR", "/usr/local/bin").
		WithExec([]string{"sh", "-c", "curl -fsSL https://proton.me/download/pass-cli/install.sh | bash"})
}

// PassCli layers the Proton Pass CLI onto the base image. Not exported by
// JIN-104's issue list on its own, but it's a direct dependency of Agent
// (via Tailscale) and Playwright/PlaywrightAgent below.
func (m *AgentPlugins) PassCli(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	return withPassCli(m.Base(platform))
}

// withTailscale installs the Tailscale client onto c.
func withTailscale(c *dagger.Container) *dagger.Container {
	return c.
		WithExec([]string{"sh", "-c", "curl -fsSL https://tailscale.com/install.sh | sh"})
}

// Tailscale layers the Tailscale client onto PassCli. Installs the binaries
// only -- joining the tailnet is a runtime concern of each consumer.
func (m *AgentPlugins) Tailscale(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	return withTailscale(m.PassCli(platform))
}

// withRestic installs restic onto c.
func withRestic(c *dagger.Container) *dagger.Container {
	return withAptPackages(c, "restic")
}

// withDaggerCli installs the Dagger CLI onto c.
func withDaggerCli(c *dagger.Container) *dagger.Container {
	return c.
		WithExec([]string{"sh", "-c", "curl -fsSL https://dl.dagger.io/dagger/install.sh | BIN_DIR=/usr/local/bin sh"})
}

// withDocker installs the Docker CLI/daemon package onto c.
func withDocker(c *dagger.Container) *dagger.Container {
	return withAptPackages(c, "docker.io")
}

// withGit installs git onto c, and sets a system-wide git identity so
// container-use's environment_create can make its initial commit
// regardless of which user/HOME it runs under (see devenv-base's withGit
// for the full JIN-57/58 history behind this).
func withGit(c *dagger.Container) *dagger.Container {
	return withAptPackages(c, "git").
		WithExec([]string{"git", "config", "--system", "user.email", "agent@tidelands.dev"}).
		WithExec([]string{"git", "config", "--system", "user.name", "tidelands-agent"}).
		WithExec([]string{"git", "config", "--system", "--add", "safe.directory", "/workspaces/devenv-base-gce"})
}

// withGh installs the GitHub CLI onto c via the official apt repository.
// Needs curl already present to fetch the keyring.
func withGh(c *dagger.Container) *dagger.Container {
	c = withAptPackages(c, "curl", "ca-certificates").
		WithExec([]string{"sh", "-c", "mkdir -p -m 755 /etc/apt/keyrings && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg"}).
		WithExec([]string{"sh", "-c", `echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list`})
	return withAptPackages(c, "gh")
}

// withContainerUse installs dagger/container-use (cu) onto c. Assumes
// withDocker and withGit have already run.
func withContainerUse(c *dagger.Container) *dagger.Container {
	return c.
		WithExec([]string{"sh", "-c", "curl -fsSL https://raw.githubusercontent.com/dagger/container-use/main/install.sh | bash"}).
		// cp, not ln -sf: the installer (run as root) drops the binary under
		// /root/.local/bin, and /root is 700 — a symlink back into it is
		// unreachable for any non-root user, even though /usr/local/bin
		// itself is world-executable.
		WithExec([]string{"cp", "/root/.local/bin/container-use", "/usr/local/bin/container-use"}).
		WithExec([]string{"cp", "/root/.local/bin/container-use", "/usr/local/bin/cu"})
}

// withClaude installs the Claude Code CLI onto c via its native installer.
func withClaude(c *dagger.Container) *dagger.Container {
	return c.
		WithExec([]string{"sh", "-c", "curl -fsSL https://claude.ai/install.sh | bash"}).
		// Same reachability trap as container-use: the installer (root) drops
		// the binary under /root/.local/bin, unreachable for non-root users
		// via a symlink because /root is 700.
		WithExec([]string{"cp", "/root/.local/bin/claude", "/usr/local/bin/claude"})
}

// Agent is the slim third image: container-use (with its dagger/docker/git
// prerequisites), pass-cli, tailscale and the Claude Code CLI — the
// always-on GCE agent box.
func (m *AgentPlugins) Agent(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	return withClaude(withContainerUse(withGit(withDocker(withDaggerCli(m.Tailscale(platform))))))
}

// CheckAgent asserts pass-cli, tailscale, container-use and claude are all
// installed and runnable, as a non-root user (see withContainerUse for why).
// +check
func (m *AgentPlugins) CheckAgent(ctx context.Context) error {
	base := m.Agent("").
		WithExec([]string{"useradd", "-m", "checkuser"}).
		WithUser("checkuser")

	if err := runToolChecks(ctx, base, []toolCheck{
		{"pass-cli", "--version", "Proton Pass CLI"},
		{"tailscale", "version", "tailscale"},
		{"container-use", "version", "container-use version"},
	}); err != nil {
		return err
	}

	out, err := base.WithExec([]string{"claude", "--version"}).Stdout(ctx)
	if err != nil {
		return fmt.Errorf("claude: %w", err)
	}
	return assertVersionLike(out)
}

// RecreateDevpod reprovisions the devenv-base GCE workspace. Delegates
// entirely to the devpod module (JIN-105 follow-up: extracted out of this
// module so it can be built/checked independently -- see
// .dagger/devpod/main.go for the actual implementation and
// ProviderAddArgs/ProviderUpdateArgs/UpArgs/CheckManifestVars/
// CheckComposedCommands for the checkable pieces of it). This module holds
// no devpod logic of its own now.
func (m *AgentPlugins) RecreateDevpod(
	ctx context.Context,
	protonPassToken *dagger.Secret,
) (string, error) {
	return dag.Devpod().RecreateDevpod(ctx, protonPassToken)
}

// withNode installs Node 22.x onto c via nodesource -- bookworm-slim ships
// no Node at all.
func withNode(c *dagger.Container) *dagger.Container {
	c = withAptPackages(c, "curl", "ca-certificates", "gnupg").
		WithExec([]string{"sh", "-c", "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -"})
	return withAptPackages(c, "nodejs")
}

// withPlaywright installs Node, the Playwright CLI and Chromium onto c.
func withPlaywright(c *dagger.Container) *dagger.Container {
	return withNode(c).
		// Must be set before the install below, and persists into the image so
		// consumers resolve the same path. Left unset, Playwright downloads
		// browsers into /root/.cache/ms-playwright, and /root is 700 — the same
		// trap that made container-use unreachable for non-root users.
		WithEnvVariable("PLAYWRIGHT_BROWSERS_PATH", "/opt/ms-playwright").
		WithExec([]string{"npm", "install", "-g", "playwright@" + playwrightVersion}).
		// Chromium only; --with-deps pulls the shared libraries it needs.
		WithExec([]string{"playwright", "install", "--with-deps", "chromium"}).
		// The install runs as root; open up traversal and execution so any user
		// can launch the browser (a+rX adds x to directories and to files that
		// are already executable, i.e. the browser binaries).
		WithExec([]string{"chmod", "-R", "a+rX", "/opt/ms-playwright"})
}

// Playwright is the slim second image: the Playwright CLI with Chromium,
// plus pass-cli and restic, and none of the rest of the chain (tailscale,
// docker, gcloud) that a browser-automation box has no use for. It branches
// off Base rather than extending anything downstream of PassCli.
func (m *AgentPlugins) Playwright(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	return withPlaywright(withRestic(withPassCli(m.Base(platform))))
}

// PlaywrightAgent is the fourth image: git, gh, Playwright with Chromium,
// pass-cli and the Claude Code CLI -- the container-use env base for agent
// work that needs to drive a browser and open a PR. Playwright (above)
// stays as the plain browser image for non-agent use; this is additive, not
// a replacement.
//
// No restic here: unlike Agent's box, this image never snapshots its own
// disk -- it exists only as a container-use env layered onto that box.
func (m *AgentPlugins) PlaywrightAgent(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	return withClaude(withPlaywright(withGh(withGit(withPassCli(m.Base(platform))))))
}

// CheckPlaywrightAgent asserts git, gh and claude are installed and
// runnable, and that the image can actually drive a browser -- as a
// non-root user, the same reachability trap withClaude and withContainerUse
// both hit.
// +check
func (m *AgentPlugins) CheckPlaywrightAgent(ctx context.Context) error {
	base := m.PlaywrightAgent("").
		WithExec([]string{"useradd", "-m", "checkuser"}).
		WithUser("checkuser")

	if err := runToolChecks(ctx, base, []toolCheck{
		{"git", "--version", "git version"},
		{"gh", "--version", "gh version"},
	}); err != nil {
		return err
	}

	claudeOut, err := base.WithExec([]string{"claude", "--version"}).Stdout(ctx)
	if err != nil {
		return fmt.Errorf("claude: %w", err)
	}
	if err := assertVersionLike(claudeOut); err != nil {
		return fmt.Errorf("claude: %w", err)
	}

	shotOut, err := base.
		WithExec([]string{"sh", "-c", "echo '<h1>ok</h1>' > /tmp/t.html && " +
			"playwright screenshot file:///tmp/t.html /tmp/out.png >/dev/null 2>&1 && " +
			"head -c 8 /tmp/out.png | od -An -tx1"}).
		Stdout(ctx)
	if err != nil {
		return fmt.Errorf("screenshot: %w", err)
	}
	// PNG magic number: a file with this header means Chromium launched and
	// rendered, not just that the CLI exited 0.
	return assertContains(shotOut, "89 50 4e 47")
}

// CheckPlaywright asserts the slim image can actually drive a browser. It
// renders a real PNG rather than printing a version — a version string says
// nothing about whether --with-deps installed the shared libraries Chromium
// needs. Runs as a non-root user for the same reason CheckContainerUse
// does: root would mask browsers being installed somewhere nobody else can
// reach.
// +check
func (m *AgentPlugins) CheckPlaywright(ctx context.Context) error {
	base := m.Playwright("").
		WithExec([]string{"useradd", "-m", "checkuser"}).
		WithUser("checkuser")

	out, err := base.
		WithExec([]string{"sh", "-c", "echo '<h1>ok</h1>' > /tmp/t.html && " +
			"playwright screenshot file:///tmp/t.html /tmp/out.png >/dev/null 2>&1 && " +
			"head -c 8 /tmp/out.png | od -An -tx1"}).
		Stdout(ctx)
	if err != nil {
		return fmt.Errorf("screenshot: %w", err)
	}
	// PNG magic number: a file with this header means Chromium launched and
	// rendered, not just that the CLI exited 0.
	if err := assertContains(out, "89 50 4e 47"); err != nil {
		return fmt.Errorf("screenshot: %w", err)
	}

	return runToolChecks(ctx, base, []toolCheck{
		{"restic", "version", "restic"},
		{"pass-cli", "--version", "Proton Pass CLI"},
	})
}

// ---------------------------------------------------------------------------
// Devcontainer/tooling test helpers (pre-existing).

// Returns a container that echoes whatever string argument is provided
func (m *AgentPlugins) ContainerEcho(stringArg string) *dagger.Container {
	return dag.Container().From("alpine:latest").WithExec([]string{"echo", stringArg})
}

// Returns lines that match a pattern in the files of the provided Directory
func (m *AgentPlugins) GrepDir(ctx context.Context, directoryArg *dagger.Directory, pattern string) (string, error) {
	return dag.Container().
		From("alpine:latest").
		WithMountedDirectory("/mnt", directoryArg).
		WithWorkdir("/mnt").
		WithExec([]string{"grep", "-R", pattern, "."}).
		Stdout(ctx)
}

// baseContainer builds a container from the devcontainer's own image, with
// mise+hk installed and the repo mounted, mirroring what a real dev
// environment would have after `mise install && hk install`.
func (m *AgentPlugins) baseContainer(source *dagger.Directory) *dagger.Container {
	return dag.Container().
		From(devcontainerImage).
		WithExec([]string{"sh", "-c", "curl -fsSL https://mise.run | sh"}).
		WithEnvVariable("PATH", "/root/.local/share/mise/shims:/root/.local/bin:$PATH", dagger.ContainerWithEnvVariableOpts{Expand: true}).
		WithMountedDirectory("/workspace", source).
		WithWorkdir("/workspace").
		WithExec([]string{"sh", "-c", "rm -rf .git && git init -q && git config user.email test@test.com && git config user.name test && git add -A && git commit -q -m init"}).
		WithExec([]string{"git", "config", "--global", "--add", "safe.directory", "/workspace"}).
		WithExec([]string{"mise", "trust"}).
		WithExec([]string{"mise", "install"})
}

// HkCheck verifies the hk hooks setup in this repo: hk installs, hk.pkl
// parses, and the lint hooks (pre-commit/fix/check) run cleanly.
func (m *AgentPlugins) HkCheck(ctx context.Context, source *dagger.Directory) (string, error) {
	ctr := m.baseContainer(source).
		WithExec([]string{"hk", "--version"}).
		WithExec([]string{"hk", "install", "--mise"}).
		WithExec([]string{"hk", "check", "--all"})

	return ctr.Stdout(ctx)
}
