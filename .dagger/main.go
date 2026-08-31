// A Dagger module for testing agent-plugins' devcontainer and tooling setup.
package main

import (
	"context"
	"dagger/agent-plugins/internal/dagger"
)

const devcontainerImage = "mcr.microsoft.com/devcontainers/javascript-node:1-20-bookworm"

type AgentPlugins struct{}

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

// withAptPackages installs pkgs via apt-get and cleans up the package
// lists, keeping the resulting image layer small.
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

// withGcloud installs the Google Cloud CLI onto c.
func withGcloud(c *dagger.Container) *dagger.Container {
	c = withAptPackages(c, "apt-transport-https", "gnupg").
		WithExec([]string{"sh", "-c", "curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg"}).
		WithExec([]string{"sh", "-c", `echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" > /etc/apt/sources.list.d/google-cloud-sdk.list`})
	return withAptPackages(c, "google-cloud-cli")
}

// withDevpod installs the DevPod CLI onto c.
func withDevpod(c *dagger.Container) *dagger.Container {
	return c.WithExec([]string{"sh", "-c", "curl -fsSL \"https://github.com/loft-sh/devpod/releases/latest/download/devpod-linux-$(dpkg --print-architecture)\" -o /usr/local/bin/devpod && chmod +x /usr/local/bin/devpod"})
}

// Keepalive builds the devpod-keepalive entrypoint image: pass-cli + gcloud
// + devpod layered onto a debian base, with devpod-keepalive.sh (and the
// gce-common.sh/check-linear-agent-webhook-live.sh/linear-agent.env files
// it needs at relative paths) baked in. Ported from devenv-base (JIN-106).
// Runs as a standalone Render Cron Job: syncs devpod's local client state
// to/from GCS each run, then pings the workspace to reset devpod's own
// INACTIVITY_TIMEOUT watchdog -- confirmed against devpod's source that
// only its own tunnel resets that timer, not a raw SSH connection to the
// VM. Only pass-cli/gcloud/devpod are installed here (unlike
// devenv-base's full Tailscale/Restic/ContainerUse/DaggerCli chain):
// tailscale-up.sh and friends run over `devpod ssh` on the remote
// workspace, not inside this image, so this image only needs what
// devpod-keepalive.sh itself calls directly.
func (m *AgentPlugins) Keepalive(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	return withDevpod(withGcloud(withPassCli(
		dag.Container(dagger.ContainerOpts{Platform: platform}).From("debian:bookworm-slim"),
	))).
		WithFile(
			"/app/keepalive/devpod-keepalive.sh",
			dag.CurrentModule().Source().File("scripts/keepalive/devpod-keepalive.sh"),
			dagger.ContainerWithFileOpts{Permissions: 0o755},
		).
		WithFile(
			"/app/.devcontainer/lib/gce-common.sh",
			dag.CurrentModule().Source().File("scripts/keepalive/devcontainer/lib/gce-common.sh"),
			dagger.ContainerWithFileOpts{Permissions: 0o644},
		).
		WithFile(
			"/app/.devcontainer/check-linear-agent-webhook-live.sh",
			dag.CurrentModule().Source().File("scripts/keepalive/devcontainer/check-linear-agent-webhook-live.sh"),
			dagger.ContainerWithFileOpts{Permissions: 0o755},
		).
		WithFile(
			"/app/.devcontainer/linear-agent.env",
			dag.CurrentModule().Source().File("scripts/keepalive/devcontainer/linear-agent.env"),
			dagger.ContainerWithFileOpts{Permissions: 0o644},
		).
		WithEntrypoint([]string{"/app/keepalive/devpod-keepalive.sh"})
}

// PublishKeepalive pushes the keepalive image to
// ghcr.io/null-hype/devenv-keepalive:<tag>. amd64 only -- it only ever runs
// as a Render Cron Job.
func (m *AgentPlugins) PublishKeepalive(
	ctx context.Context,
	tag string,
	githubUser string,
	githubToken *dagger.Secret,
) (string, error) {
	return dag.Container().
		WithRegistryAuth("ghcr.io", githubUser, githubToken).
		Publish(ctx, "ghcr.io/null-hype/devenv-keepalive:"+tag, dagger.ContainerPublishOpts{
			PlatformVariants: []*dagger.Container{
				m.Keepalive("linux/amd64"),
			},
		})
}

// CheckKeepalive asserts the keepalive script is present, executable and
// syntactically valid. It can't exercise a real run in CI -- that needs
// live GCP and Proton Pass secrets plus an existing workspace -- so this
// only catches shell syntax errors and packaging mistakes.
// +check
func (m *AgentPlugins) CheckKeepalive(ctx context.Context) error {
	_, err := m.Keepalive("").
		WithExec([]string{"bash", "-n", "/app/keepalive/devpod-keepalive.sh"}).
		WithExec([]string{"bash", "-n", "/app/.devcontainer/lib/gce-common.sh"}).
		WithExec([]string{"bash", "-n", "/app/.devcontainer/check-linear-agent-webhook-live.sh"}).
		WithExec([]string{"sh", "-c", "test -x /app/keepalive/devpod-keepalive.sh"}).
		Stdout(ctx)
	return err
}
