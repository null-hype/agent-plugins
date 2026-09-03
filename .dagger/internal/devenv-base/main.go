// devenv-base is the shared base image for the always-on dev/agent
// environments (container-use-env's GCE devcontainer, render-ssh-demo's
// Render service). Each capability (pass-cli, tailscale, restic, gcloud) is
// added as its own function plus a Check that exercises it for real.
package main

import (
	"context"
	"fmt"

	"dagger/devenv-base/internal/dagger"
)

type DevenvBase struct{}

// Base returns the shared bookworm-slim base image all capabilities layer
// onto. platform defaults to the host/engine platform if omitted; Publish
// pins it explicitly per architecture to build a multi-platform image.
func (m *DevenvBase) Base(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	return dag.Container(dagger.ContainerOpts{Platform: platform}).From("debian:bookworm-slim")
}

// publish pushes the given platform variants to ghcr.io/null-hype/<image>:<tag>,
// authenticating with the given GitHub username/token. Shared by the exported
// Publish* functions, one per image this module ships.
func publish(
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
// ghcr.io/null-hype/devenv-base:<tag>, authenticating with the given GitHub
// username/token.
func (m *DevenvBase) Publish(
	ctx context.Context,
	tag string,
	githubUser string,
	githubToken *dagger.Secret,
) (string, error) {
	return publish(ctx, "devenv-base", tag, githubUser, githubToken, []*dagger.Container{
		m.Devpod("linux/amd64"),
		m.Devpod("linux/arm64"),
	})
}

// PublishPlaywright pushes the slim Playwright image to
// ghcr.io/null-hype/devenv-playwright:<tag>. amd64 only: an arm64 variant
// would run playwright install --with-deps under QEMU emulation on GitHub's
// amd64 runners, for a browser box nothing currently pulls on arm64.
func (m *DevenvBase) PublishPlaywright(
	ctx context.Context,
	tag string,
	githubUser string,
	githubToken *dagger.Secret,
) (string, error) {
	return publish(ctx, "devenv-playwright", tag, githubUser, githubToken, []*dagger.Container{
		m.Playwright("linux/amd64"),
	})
}

// PublishAgent pushes the slim Agent image (container-use, pass-cli,
// tailscale, Claude Code) to ghcr.io/null-hype/devenv-agent:<tag>. amd64
// only, matching where this image actually runs (GCE VMs).
func (m *DevenvBase) PublishAgent(
	ctx context.Context,
	tag string,
	githubUser string,
	githubToken *dagger.Secret,
) (string, error) {
	return publish(ctx, "devenv-agent", tag, githubUser, githubToken, []*dagger.Container{
		m.Agent("linux/amd64"),
	})
}

// PublishPlaywrightAgent pushes the PlaywrightAgent image (git, gh,
// Playwright+Chromium, pass-cli, Claude Code — the container-use env base
// for browser-driving agent work) to
// ghcr.io/null-hype/devenv-playwright-agent:<tag>. amd64 only, matching
// Agent and Playwright: this runs as a container-use env on the same GCE
// box as Agent, which is amd64.
func (m *DevenvBase) PublishPlaywrightAgent(
	ctx context.Context,
	tag string,
	githubUser string,
	githubToken *dagger.Secret,
) (string, error) {
	return publish(ctx, "devenv-playwright-agent", tag, githubUser, githubToken, []*dagger.Container{
		m.PlaywrightAgent("linux/amd64"),
	})
}

// CheckBase asserts the base image is the expected Debian release.
// +check
func (m *DevenvBase) CheckBase(ctx context.Context) error {
	out, err := m.Base("").
		WithExec([]string{"sh", "-c", "grep VERSION_CODENAME /etc/os-release"}).
		Stdout(ctx)
	if err != nil {
		return err
	}
	return assertContains(out, "bookworm")
}

// ---------------------------------------------------------------------------
// with* helpers: one per tool, independently composable, no ordering baked
// in. Exported rung functions below (PassCli, Tailscale, ...) are thin
// aliases chaining these in the order the published images have always
// used; new images compose the same helpers in whatever order they need.

// withAptPackages runs apt-get update, installs pkgs with
// --no-install-recommends, and drops the package list cache in one exec.
// Every with* helper that needs apt goes through this so each is
// self-contained on any base it's layered onto, not just the one the
// original chain put it after.
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

// PassCli layers the Proton Pass CLI onto the base image.
func (m *DevenvBase) PassCli(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	return withPassCli(m.Base(platform))
}

// withTailscale installs the Tailscale client onto c. No apt packages of
// its own -- the installer script is self-contained.
func withTailscale(c *dagger.Container) *dagger.Container {
	return c.
		WithExec([]string{"sh", "-c", "curl -fsSL https://tailscale.com/install.sh | sh"})
}

// Tailscale layers the Tailscale client onto PassCli. It installs the
// binaries only — joining the tailnet (kernel-mode, needing NET_ADMIN and
// /dev/net/tun) is a runtime concern of each consumer, not this build.
func (m *DevenvBase) Tailscale(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	return withTailscale(m.PassCli(platform))
}

// withRestic installs restic onto c.
func withRestic(c *dagger.Container) *dagger.Container {
	return withAptPackages(c, "restic")
}

// Restic layers restic onto Tailscale (both repos use it to snapshot the
// persistent disk to GCS).
func (m *DevenvBase) Restic(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	return withRestic(m.Tailscale(platform))
}

// withDaggerCli installs the Dagger CLI onto c.
func withDaggerCli(c *dagger.Container) *dagger.Container {
	return c.
		WithExec([]string{"sh", "-c", "curl -fsSL https://dl.dagger.io/dagger/install.sh | BIN_DIR=/usr/local/bin sh"})
}

// DaggerCli layers the Dagger CLI onto Restic. It's a prerequisite for
// ContainerUse, which wraps it.
func (m *DevenvBase) DaggerCli(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	return withDaggerCli(m.Restic(platform))
}

// withDocker installs the Docker CLI/daemon package onto c. Split out of
// what used to be container-use's own apt line so it's a named, reusable
// dependency instead of smuggled in.
func withDocker(c *dagger.Container) *dagger.Container {
	return withAptPackages(c, "docker.io")
}

// withGit installs git onto c. Split out for the same reason as withDocker
// -- previously the only place git entered the build was buried inside
// withContainerUse's apt line, which meant any image that didn't route
// through container-use had no git (see PlaywrightAgent).
//
// Also sets a system-wide (not --global, which is per-HOME and wiped along
// with any ephemeral container/HOME) git identity: container-use's
// environment_create makes an initial commit as whatever user the calling
// process runs as -- root, for the linear-agent's node process (see
// start-linear-agent.sh) -- and a root with no configured identity fails
// every single environment_create with "Author identity unknown", not just
// on first boot but forever, since nothing else in this image chain sets
// one. Confirmed live: reproduced by hand-driving container-use's MCP
// stdio protocol directly against a freshly --reset box (JIN-57/58).
//
// Also marks /workspaces/devenv-base-gce as a safe.directory, system-wide
// for the same ephemeral-HOME reason: the repo there is cloned/owned by
// vscode (devpod's remoteUser), but the linear-agent's node process runs
// as root with no SUDO_UID (unlike an interactive `devpod ssh` session,
// which sudo stamps with SUDO_UID=<the real user>, letting git's ownership
// check pass incidentally) -- so root vs. vscode is a genuine owner
// mismatch and container-use's environment_create fails opening the repo
// at all ("unable to open repository: you must be in a git repository").
// Every earlier manual repro of this bug via `sudo ... git status` or
// `sudo ... container-use stdio` passed *only* because sudo's SUDO_UID
// carve-out masked it; reproduced for real by stripping SUDO_UID/SUDO_GID/
// SUDO_USER to match the node process's actual environment (JIN-58).
func withGit(c *dagger.Container) *dagger.Container {
	return withAptPackages(c, "git").
		WithExec([]string{"git", "config", "--system", "user.email", "agent@tidelands.dev"}).
		WithExec([]string{"git", "config", "--system", "user.name", "tidelands-agent"}).
		WithExec([]string{"git", "config", "--system", "--add", "safe.directory", "/workspaces/devenv-base-gce"})
}

// withGh installs the GitHub CLI onto c via the official apt repository.
// Needs curl (from withPassCli) already present to fetch the keyring.
func withGh(c *dagger.Container) *dagger.Container {
	c = c.
		WithExec([]string{"sh", "-c", "mkdir -p -m 755 /etc/apt/keyrings && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg"}).
		WithExec([]string{"sh", "-c", `echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list`})
	return withAptPackages(c, "gh")
}

// withContainerUse installs dagger/container-use (cu) onto c. Assumes
// withDocker and withGit have already run -- it no longer installs them
// itself, so a caller building an image with cu must compose those two
// explicitly (see ContainerUse and Agent below).
func withContainerUse(c *dagger.Container) *dagger.Container {
	return c.
		WithExec([]string{"sh", "-c", "curl -fsSL https://raw.githubusercontent.com/dagger/container-use/main/install.sh | bash"}).
		// cp, not ln -sf: the installer (run as root) drops the binary under
		// /root/.local/bin, and /root is 700 — a symlink back into it is
		// unreachable for any non-root user (e.g. devcontainers' vscode
		// user), even though /usr/local/bin itself is world-executable.
		WithExec([]string{"cp", "/root/.local/bin/container-use", "/usr/local/bin/container-use"}).
		WithExec([]string{"cp", "/root/.local/bin/container-use", "/usr/local/bin/cu"})
}

// ContainerUse layers docker, git and dagger/container-use (cu) onto
// DaggerCli, in that order -- the same packages withContainerUse used to
// install inline, now three named steps.
func (m *DevenvBase) ContainerUse(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	return withContainerUse(withGit(withDocker(m.DaggerCli(platform))))
}

// CheckContainerUse asserts container-use is installed and runnable — as a
// non-root user, since running as root previously masked a real bug (the
// installed binary was unreachable for anyone but root).
// +check
func (m *DevenvBase) CheckContainerUse(ctx context.Context) error {
	base := m.ContainerUse("").
		WithExec([]string{"useradd", "-m", "checkuser"})
	return runToolChecksAsUser(ctx, base, "checkuser", []toolCheck{
		{"container-use", "version", "container-use version"},
		{"cu", "version", "container-use version"},
	})
}

// withGitButler installs GitButler's CLI (but) onto c (JIN-117). Assumes
// withGit has already run: but setup's commit/HEAD flows need a git identity
// present beforehand, same as container-use's environment_create, and
// withGit's fix is a --system (process-wide, HOME-independent) git config,
// not --global -- confirmed that scope covers but too, not just cu, since
// both just shell out to git and inherit whatever identity the process's git
// config resolves to.
func withGitButler(c *dagger.Container) *dagger.Container {
	// but fails at runtime with a missing libdbus-1.so.3 error without this --
	// not pulled in automatically by the bookworm-slim base image.
	c = withAptPackages(c, "libdbus-1-3")
	return c.
		WithExec([]string{"sh", "-c", "curl -fsSL https://gitbutler.com/install.sh | sh"}).
		// cp, not ln -sf: same root-only-install-dir trap withContainerUse
		// handles above -- the installer (root) drops the binary under
		// /root/.local/bin, and /root is 700, unreachable for a non-root user
		// via a symlink even though /usr/local/bin itself is world-executable.
		WithExec([]string{"cp", "/root/.local/bin/but", "/usr/local/bin/but"})
}

// GitButler layers GitButler's CLI (but) onto ContainerUse, alongside cu --
// the composition JIN-95's scenario needs (a but workspace one layer up
// applying cu env branches as lanes).
func (m *DevenvBase) GitButler(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	return withGitButler(m.ContainerUse(platform))
}

// CheckGitButler asserts but is installed and runnable — as a non-root
// user, the same reachability trap CheckContainerUse guards against.
// +check
func (m *DevenvBase) CheckGitButler(ctx context.Context) error {
	out, err := m.GitButler("").
		WithExec([]string{"useradd", "-m", "checkuser"}).
		WithUser("checkuser").
		WithExec([]string{"but", "--version"}).
		Stdout(ctx)
	if err != nil {
		return err
	}
	return assertVersionLike(out)
}

// withGcloud installs the gcloud CLI onto c. Runs its own apt-get update
// (via withAptPackages) rather than assuming a caller already refreshed the
// package cache -- flattening the graph means Gcloud can no longer count on
// ContainerUse having just done that for it.
func withGcloud(c *dagger.Container) *dagger.Container {
	c = withAptPackages(c, "apt-transport-https", "gnupg").
		WithExec([]string{"sh", "-c", "curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg"}).
		WithExec([]string{"sh", "-c", `echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" > /etc/apt/sources.list.d/google-cloud-sdk.list`})
	return withAptPackages(c, "google-cloud-cli")
}

// Gcloud layers the gcloud CLI onto ContainerUse.
func (m *DevenvBase) Gcloud(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	return withGcloud(m.ContainerUse(platform))
}

// CheckGcloud asserts gcloud is installed and runnable.
// +check
func (m *DevenvBase) CheckGcloud(ctx context.Context) error {
	return runToolChecks(ctx, m.Gcloud(""), []toolCheck{
		{"gcloud", "--version", "Google Cloud SDK"},
	})
}

// withDevpod installs the DevPod CLI onto c.
func withDevpod(c *dagger.Container) *dagger.Container {
	return c.WithExec([]string{"sh", "-c", "curl -fsSL \"https://github.com/loft-sh/devpod/releases/latest/download/devpod-linux-$(dpkg --print-architecture)\" -o /usr/local/bin/devpod && chmod +x /usr/local/bin/devpod"})
}

// Devpod layers the DevPod CLI onto Gcloud.
func (m *DevenvBase) Devpod(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	return withDevpod(m.Gcloud(platform))
}

// CheckDevpod asserts devpod is installed and runnable.
// +check
func (m *DevenvBase) CheckDevpod(ctx context.Context) error {
	out, err := m.Devpod("").
		WithExec([]string{"devpod", "version"}).
		Stdout(ctx)
	if err != nil {
		return err
	}
	return assertVersionLike(out)
}

// Keepalive layers the devpod-keepalive.sh entrypoint onto Devpod. Runs as a
// standalone Render Cron Job: syncs devpod's local client state (the only
// thing that lets `devpod ssh` find an existing GCE machine instead of
// provisioning a new one -- confirmed the hard way) to/from a GCS bucket
// each run, then pings the workspace to reset devpod's own
// INACTIVITY_TIMEOUT watchdog. Confirmed against devpod's source that only
// its own tunnel resets that timer, not a raw SSH connection to the VM.
func (m *DevenvBase) Keepalive(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	// devpod-keepalive.sh sources gce-common.sh (shared with devpod-gce.sh)
	// and, at the end, runs check-linear-agent-webhook-live.sh (which in
	// turn opens its own pass-cli session against linear-agent.env) via
	// paths relative to itself, so all four files are laid down here
	// preserving the same relative structure they have in the repo.
	// continue-claude-session.sh/.env are NOT baked in here despite
	// devpod-keepalive.sh now calling it: like install-tools.sh,
	// tailscale-up.sh and start-linear-agent.sh, it runs over `devpod ssh`
	// -- i.e. on the devpod's own repo checkout, not inside this image --
	// so it only needs to exist in the repo, not in /app.
	return m.Devpod(platform).
		WithFile(
			"/app/keepalive/devpod-keepalive.sh",
			dag.CurrentModule().Source().File("keepalive/devpod-keepalive.sh"),
			dagger.ContainerWithFileOpts{Permissions: 0o755},
		).
		WithFile(
			"/app/.devcontainer/lib/gce-common.sh",
			dag.CurrentModule().Source().File(".devcontainer/lib/gce-common.sh"),
			dagger.ContainerWithFileOpts{Permissions: 0o644},
		).
		WithFile(
			"/app/.devcontainer/check-linear-agent-webhook-live.sh",
			dag.CurrentModule().Source().File(".devcontainer/check-linear-agent-webhook-live.sh"),
			dagger.ContainerWithFileOpts{Permissions: 0o755},
		).
		WithFile(
			"/app/.devcontainer/linear-agent.env",
			dag.CurrentModule().Source().File(".devcontainer/linear-agent.env"),
			dagger.ContainerWithFileOpts{Permissions: 0o644},
		).
		WithEntrypoint([]string{"/app/keepalive/devpod-keepalive.sh"})
}

// PublishKeepalive pushes the keepalive image to
// ghcr.io/null-hype/devenv-keepalive:<tag>. amd64 only -- it only ever runs
// as a Render Cron Job.
func (m *DevenvBase) PublishKeepalive(
	ctx context.Context,
	tag string,
	githubUser string,
	githubToken *dagger.Secret,
) (string, error) {
	return publish(ctx, "devenv-keepalive", tag, githubUser, githubToken, []*dagger.Container{
		m.Keepalive("linux/amd64"),
	})
}

// CheckKeepalive asserts the keepalive script is present, executable and
// syntactically valid. It can't exercise a real run in CI -- that needs live
// GCP and Proton Pass secrets plus an existing workspace -- so this only
// catches shell syntax errors and packaging mistakes.
// +check
func (m *DevenvBase) CheckKeepalive(ctx context.Context) error {
	out, err := m.Keepalive("").
		WithExec([]string{"bash", "-n", "/app/keepalive/devpod-keepalive.sh"}).
		WithExec([]string{"bash", "-n", "/app/.devcontainer/lib/gce-common.sh"}).
		WithExec([]string{"sh", "-c", "test -x /app/keepalive/devpod-keepalive.sh && echo executable"}).
		Stdout(ctx)
	if err != nil {
		return err
	}
	return assertContains(out, "executable")
}

// withClaude installs the Claude Code CLI onto c via its native installer
// (no Node dependency, unlike `npm install -g @anthropic-ai/claude-code`),
// keeping tool chains that don't otherwise need Node free of one.
func withClaude(c *dagger.Container) *dagger.Container {
	return c.
		WithExec([]string{"sh", "-c", "curl -fsSL https://claude.ai/install.sh | bash"}).
		// Same reachability trap as container-use: the installer (root) drops
		// the binary under /root/.local/bin, unreachable for non-root users
		// via a symlink because /root is 700.
		WithExec([]string{"cp", "/root/.local/bin/claude", "/usr/local/bin/claude"})
}

// Agent is the slim third image: container-use (with its dagger/docker/git
// prerequisites), GitButler's but (JIN-117 -- the layer above cu that
// applies its env branches as lanes, per JIN-95), pass-cli, tailscale and
// the Claude Code CLI — the always-on GCE agent box. Branches off Tailscale
// directly, skipping Restic and Gcloud/Devpod: this box doesn't snapshot its
// own disk or talk to GCP APIs itself, so it has no use for either.
func (m *DevenvBase) Agent(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	return withClaude(withGitButler(withContainerUse(withGit(withDocker(withDaggerCli(m.Tailscale(platform)))))))
}

// CheckAgent asserts pass-cli, tailscale, container-use, but and claude are
// all installed and runnable, as a non-root user (see CheckContainerUse for
// why).
// +check
func (m *DevenvBase) CheckAgent(ctx context.Context) error {
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

	butOut, err := base.WithExec([]string{"but", "--version"}).Stdout(ctx)
	if err != nil {
		return fmt.Errorf("but: %w", err)
	}
	if err := assertVersionLike(butOut); err != nil {
		return fmt.Errorf("but: %w", err)
	}

	out, err := base.WithExec([]string{"claude", "--version"}).Stdout(ctx)
	if err != nil {
		return fmt.Errorf("claude: %w", err)
	}
	return assertVersionLike(out)
}

// playwrightVersion pins the npm package so image builds are reproducible.
const playwrightVersion = "1.62.1"

// withNode installs Node 22.x onto c via nodesource -- bookworm-slim (which
// several of these chains are built on) ships no Node at all.
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

// Playwright is the slim second image: the Playwright CLI with Chromium, plus
// pass-cli and restic, and none of the rest of the chain (tailscale, docker,
// gcloud, devpod) that a browser-automation box has no use for. It branches
// off Base rather than extending Devpod, so it shares layers with nothing
// downstream of PassCli.
func (m *DevenvBase) Playwright(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	return withPlaywright(withRestic(withPassCli(m.Base(platform))))
}

// PlaywrightAgent is the fourth published image: git, gh, Playwright with
// Chromium, pass-cli and the Claude Code CLI -- the container-use env base
// for agent work that needs to drive a browser and open a PR. Playwright
// (above) stays as the plain browser image for non-agent use; this is
// additive, not a replacement.
//
// No restic here: unlike Agent's GCE box, this image never snapshots its
// own disk -- it exists only as a container-use env layered onto that box,
// which is what backs it up. Restic was in the old Playwright chain because
// that box did snapshot its own disk; it isn't load-bearing for this one
// unless a future durable-env-refs design (JIN-42) ends up using restic as
// its transport, at which point this recipe changes.
func (m *DevenvBase) PlaywrightAgent(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	return withClaude(withPlaywright(withGh(withGit(withPassCli(m.Base(platform))))))
}

// CheckPlaywrightAgent asserts git, gh and claude are installed and runnable,
// and that the image can actually drive a browser -- as a non-root user, the
// same reachability trap withClaude and withContainerUse both hit.
// +check
func (m *DevenvBase) CheckPlaywrightAgent(ctx context.Context) error {
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

// LinearAgent layers Node, Claude Code and the linear-agent npm project
// (source under linear-agent/) onto Devpod, not Agent: Devpod is what
// .devcontainer/devcontainer.json actually deploys as the always-on GCE box
// (published as devenv-base -- see Publish), and it's what verify-tools.sh
// and devpod-gce.sh expect to find there (gcloud, devpod, restic,
// tailscale). Agent is a different, incompatible branch of the chain (has
// claude, lacks those three) not currently used for that box. claude is
// baked in here (install-tools.sh no longer installs it at runtime -- the
// image system exists to bake tools, not defer them to first boot). The
// box's public route is `tailscale funnel` (tailscale is already joined via
// tailscale-up.sh), not a separate tunnel tool. Doesn't set an entrypoint or
// start command -- start-linear-agent.sh runs the server and opens the
// funnel, invoked over `devpod ssh` by devpod-gce.sh/devpod-keepalive.sh.
func (m *DevenvBase) LinearAgent(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	return withClaude(withNode(m.Devpod(platform))).
		WithDirectory("/app", dag.CurrentModule().Source().Directory("linear-agent")).
		WithWorkdir("/app").
		WithExec([]string{"npm", "ci"})
}

// LinearAgentSlim builds the same linear-agent app directly on node:22-slim
// instead of layering onto Devpod. Not what gets published (PublishLinearAgent
// uses LinearAgent, matching what actually runs in production) -- this is for
// quickly booting the real app with real secrets to check config end-to-end
// (real Linear API/webhook calls, not a reimplementation), without paying for
// the gcloud/docker/devpod/etc. layers a config smoke test doesn't need.
func (m *DevenvBase) LinearAgentSlim(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	return dag.Container(dagger.ContainerOpts{Platform: platform}).
		From("node:22-slim").
		WithDirectory("/app", dag.CurrentModule().Source().Directory("linear-agent")).
		WithWorkdir("/app").
		WithExec([]string{"npm", "ci"})
}

// CheckLinearAgent runs the real test suite (src/webhook.test.ts), which
// exercises actual HMAC signature verification through the real
// @linear/sdk LinearWebhookClient against a live HTTP server -- not a
// reimplementation of Linear's verification logic.
// +check
func (m *DevenvBase) CheckLinearAgent(ctx context.Context) error {
	out, err := m.LinearAgent("").
		WithExec([]string{"npm", "test"}).
		Stdout(ctx)
	if err != nil {
		return err
	}
	return assertContains(out, "# fail 0")
}

// PublishLinearAgent pushes the built linear-agent app to
// ghcr.io/null-hype/devenv-linear-agent:<tag>. amd64 only, matching Devpod
// (this is the image devcontainer.json now targets). No entrypoint is set
// -- start-linear-agent.sh runs the server once the box is up.
func (m *DevenvBase) PublishLinearAgent(
	ctx context.Context,
	tag string,
	githubUser string,
	githubToken *dagger.Secret,
) (string, error) {
	built := m.LinearAgent("linux/amd64").
		WithExec([]string{"npm", "run", "build"})

	return publish(ctx, "devenv-linear-agent", tag, githubUser, githubToken, []*dagger.Container{built})
}

// RecreateDevpod runs `.devcontainer/devpod-gce.sh --reset` inside the
// Devpod image, for a GitHub Actions workflow_dispatch to reprovision the
// GCE box on demand (e.g. after PublishLinearAgent, to pick up a rebuilt
// image) without installing devpod/gcloud/restic/pass-cli on the runner
// itself -- same reasoning as Keepalive baking devpod-keepalive.sh onto
// Devpod for Render, just invoked directly via `dagger call` instead of
// published as its own image. PROTON_PASS_KEY_PROVIDER is set explicitly
// here (fs) because, unlike a devcontainer session, nothing else in this
// container sets it -- devpod-gce.sh itself doesn't, since it normally
// inherits that from devcontainer.json's remoteEnv. protonPassToken is a
// *dagger.Secret, not a plain string, so it never lands in Dagger's
// cache/plan output or GitHub Actions logs.
//
// --reset, not --recreate: `devpod up --recreate` only rebuilds the
// container from whatever devcontainer.json is already checked out on the
// box -- it does NOT re-fetch the git source, per `devpod up --help`
// ("--recreate: remove any existing containers and recreate them" vs
// "--reset: remove any existing containers including sources, and recreate
// them"). Confirmed live: a --recreate run against an already-provisioned
// box logged "Rebuiling without resetting a git based workspace, keeping
// old content folder" and reused the exact same cached
// vsc-content-*:devpod-<hash> image as before a push, i.e. it silently
// redeployed nothing. --reset re-clones from origin/main so a new commit
// actually lands.
func (m *DevenvBase) RecreateDevpod(
	ctx context.Context,
	protonPassToken *dagger.Secret,
	// Branch/ref devpod-gce.sh clones the devpod's content from. Defaults to
	// main; override to validate a fix against an unmerged PR branch before
	// it lands, since --reset always re-clones from this ref regardless of
	// what ref this dagger call itself is running from.
	// +optional
	// +default="main"
	gitRef string,
) (string, error) {
	return m.Devpod("linux/amd64").
		WithFile(
			"/app/.devcontainer/devpod-gce.sh",
			dag.CurrentModule().Source().File(".devcontainer/devpod-gce.sh"),
			dagger.ContainerWithFileOpts{Permissions: 0o755},
		).
		WithFile(
			"/app/.devcontainer/lib/gce-common.sh",
			dag.CurrentModule().Source().File(".devcontainer/lib/gce-common.sh"),
			dagger.ContainerWithFileOpts{Permissions: 0o644},
		).
		WithFile(
			"/app/.devcontainer/gcloud.env",
			dag.CurrentModule().Source().File(".devcontainer/gcloud.env"),
			dagger.ContainerWithFileOpts{Permissions: 0o644},
		).
		WithWorkdir("/app").
		WithEnvVariable("PROTON_PASS_KEY_PROVIDER", "fs").
		WithEnvVariable("DEVPOD_GCE_GIT_REF", gitRef).
		WithSecretVariable("PROTON_PASS_PERSONAL_ACCESS_TOKEN", protonPassToken).
		WithExec([]string{"bash", ".devcontainer/devpod-gce.sh", "--reset"}).
		Stdout(ctx)
}

// TriggerRenderCron POSTs Render's "trigger cron job run" endpoint
// (https://api-docs.render.com/reference/run-cron-job) to manually kick a
// run of the devpod-keepalive Render Cron Job (render.yaml) from a GitHub
// Actions workflow_dispatch, instead of waiting for its hourly schedule.
// RENDER_API_KEY/RENDER_SERVICE_ID are resolved from Proton Pass inside
// trigger-render-cron.sh via render.env's pass:// refs (same indirection
// gcloud.env/linear-agent.env use for their secrets), so neither value has
// to be stored as a plain GitHub Actions secret -- only the Proton Pass
// token itself does.
func (m *DevenvBase) TriggerRenderCron(
	ctx context.Context,
	protonPassToken *dagger.Secret,
) (string, error) {
	return withPassCli(m.Base("")).
		WithFile(
			"/app/.devcontainer/trigger-render-cron.sh",
			dag.CurrentModule().Source().File(".devcontainer/trigger-render-cron.sh"),
			dagger.ContainerWithFileOpts{Permissions: 0o755},
		).
		WithFile(
			"/app/.devcontainer/render.env",
			dag.CurrentModule().Source().File(".devcontainer/render.env"),
			dagger.ContainerWithFileOpts{Permissions: 0o644},
		).
		WithWorkdir("/app").
		WithEnvVariable("PROTON_PASS_KEY_PROVIDER", "fs").
		WithSecretVariable("PROTON_PASS_PERSONAL_ACCESS_TOKEN", protonPassToken).
		WithExec([]string{"bash", ".devcontainer/trigger-render-cron.sh"}).
		Stdout(ctx)
}

// CheckPlaywright asserts the slim image can actually drive a browser, and
// that pass-cli and restic came along with it. It renders a real PNG rather
// than printing a version — a version string says nothing about whether
// --with-deps installed the shared libraries Chromium needs. Runs as a
// non-root user for the same reason CheckContainerUse does: root would mask
// browsers being installed somewhere nobody else can reach.
// +check
func (m *DevenvBase) CheckPlaywright(ctx context.Context) error {
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

// LinearTriageAgent queries Linear for issues carrying labelFilter, and for
// each one compiles a hermetic per-issue working directory (the issue plus
// its comment thread, and the ExitPlanMode->Linear hook under
// .devcontainer/linear-triage/) and runs headless claude against it in
// plan mode. The hook is the only write path back to Linear: it files a
// new triage issue from whatever plan claude proposes, referencing the
// source issue. A human reviews and acts on the triage issues this
// creates -- it never mutates the source issue or assigns/resolves
// anything itself.
//
// This replaces the earlier devpod-ssh + restic + `claude --resume` design
// (continue-claude-session.sh) for the "review Linear and propose next
// steps" job: there's no persistent ~/.claude session carrying state
// between runs. State instead lives in Linear itself -- the label marks
// what still needs review, the source issue's thread is the context, and
// the new triage issue is the output -- so the container this runs in is
// fully disposable, and the cron path collapses from
// cron -> agent -> linear -> agent -> linear (devpod-keepalive triggering
// continue-claude-session.sh, which acts via the Linear MCP connector,
// whose output the separate linear-agent webhook service then reacts to)
// down to cron -> agent -> linear (this function, called directly).
//
// No restic/tailscale/docker/devpod -- unlike Agent, this box neither
// snapshots state nor needs a devpod to ssh into. protonPassToken is a
// *dagger.Secret so it never lands in Dagger's cache/plan output or logs.
func (m *DevenvBase) LinearTriageAgent(
	ctx context.Context,
	protonPassToken *dagger.Secret,
	// +optional
	// +default="agent-triage"
	labelFilter string,
) (string, error) {
	return withClaude(m.PassCli("linux/amd64")).
		WithFile(
			"/app/.devcontainer/lib/linear-query.sh",
			dag.CurrentModule().Source().File(".devcontainer/lib/linear-query.sh"),
			dagger.ContainerWithFileOpts{Permissions: 0o755},
		).
		WithFile(
			"/app/.devcontainer/linear-triage-agent.sh",
			dag.CurrentModule().Source().File(".devcontainer/linear-triage-agent.sh"),
			dagger.ContainerWithFileOpts{Permissions: 0o755},
		).
		WithFile(
			"/app/.devcontainer/linear-triage-agent.env",
			dag.CurrentModule().Source().File(".devcontainer/linear-triage-agent.env"),
			dagger.ContainerWithFileOpts{Permissions: 0o644},
		).
		WithFile(
			"/app/.devcontainer/linear-triage/settings.json",
			dag.CurrentModule().Source().File(".devcontainer/linear-triage/settings.json"),
			dagger.ContainerWithFileOpts{Permissions: 0o644},
		).
		WithFile(
			"/app/.devcontainer/linear-triage/hooks/exit-plan-to-linear.sh",
			dag.CurrentModule().Source().File(".devcontainer/linear-triage/hooks/exit-plan-to-linear.sh"),
			dagger.ContainerWithFileOpts{Permissions: 0o755},
		).
		WithWorkdir("/app").
		WithEnvVariable("PROTON_PASS_KEY_PROVIDER", "fs").
		WithEnvVariable("LINEAR_TRIAGE_LABEL", labelFilter).
		WithSecretVariable("PROTON_PASS_PERSONAL_ACCESS_TOKEN", protonPassToken).
		WithExec([]string{"bash", "-c", `
set -euo pipefail
if ! pass-cli info >/dev/null 2>&1; then
  pass-cli logout --force >/dev/null 2>&1 || true
  pass-cli login
fi
export PROTON_PASS_AGENT_REASON="linear-triage-agent: resolve LINEAR_API_KEY/CLAUDE_CODE_OAUTH_TOKEN and run per-issue plan-mode review"
export LINEAR_QUERY_FILE=/app/.devcontainer/lib/linear-query.sh
pass-cli run --env-file .devcontainer/linear-triage-agent.env -- bash .devcontainer/linear-triage-agent.sh
`}).
		Stdout(ctx)
}

// CheckPassCli asserts pass-cli is installed and runnable.
// +check
func (m *DevenvBase) CheckPassCli(ctx context.Context) error {
	return runToolChecks(ctx, m.PassCli(""), []toolCheck{
		{"pass-cli", "--version", "Proton Pass CLI"},
	})
}

// CheckTailscale asserts tailscale is installed and runnable. Deliberately
// safe everywhere: it only checks the CLI binary exists and reports a
// version, not that a tailnet join succeeds — that needs NET_ADMIN/TUN,
// which the unprivileged Dagger sandbox (like Render) doesn't grant.
// +check
func (m *DevenvBase) CheckTailscale(ctx context.Context) error {
	return runToolChecks(ctx, m.Tailscale(""), []toolCheck{
		{"tailscale", "version", "tailscale"},
	})
}

// CheckRestic asserts restic is installed and runnable.
// +check
func (m *DevenvBase) CheckRestic(ctx context.Context) error {
	return runToolChecks(ctx, m.Restic(""), []toolCheck{
		{"restic", "version", "restic"},
	})
}

// CheckDaggerCli asserts the dagger CLI is installed and runnable.
// +check
func (m *DevenvBase) CheckDaggerCli(ctx context.Context) error {
	return runToolChecks(ctx, m.DaggerCli(""), []toolCheck{
		{"dagger", "version", "dagger"},
	})
}
