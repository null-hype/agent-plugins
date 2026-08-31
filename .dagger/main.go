// A Dagger module for testing agent-plugins' devcontainer and tooling setup.
package main

import (
	"context"
	"dagger/agent-plugins/internal/dagger"
	"fmt"
	"strings"
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

// withNode installs Node 22 onto c.
func withNode(c *dagger.Container) *dagger.Container {
	c = withAptPackages(c, "curl", "ca-certificates", "gnupg").
		WithExec([]string{"sh", "-c", "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -"})
	return withAptPackages(c, "nodejs")
}

// withClaude installs the Claude Code CLI onto c.
func withClaude(c *dagger.Container) *dagger.Container {
	return c.
		WithExec([]string{"sh", "-c", "curl -fsSL https://claude.ai/install.sh | bash"}).
		// Same reachability trap as devenv-base's own withClaude: the
		// installer (root) drops the binary under /root/.local/bin,
		// unreachable for non-root users via a symlink because /root is 700.
		WithExec([]string{"cp", "/root/.local/bin/claude", "/usr/local/bin/claude"})
}

// LinearAgent layers Node, Claude Code and the linear-agent npm project
// (source under linear-agent/, ported wholesale from devenv-base -- JIN-107)
// onto a plain debian base. devenv-base's own LinearAgent instead layers
// onto its Devpod image (the always-on GCE box that .devcontainer/
// devcontainer.json deploys, with gcloud/devpod/restic/tailscale already
// baked in) -- that image and the GCE box it targets are out of scope for
// this repo, so this only reproduces the two layers the linear-agent app
// itself actually needs to build and run: Node (the runtime) and claude
// (claude.ts shells out to it as a subprocess). Doesn't set an
// entrypoint/start command -- start-linear-agent.sh (see
// .dagger/scripts/) runs the server once the image is deployed.
func (m *AgentPlugins) LinearAgent(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	return withClaude(withNode(
		dag.Container(dagger.ContainerOpts{Platform: platform}).From("debian:bookworm-slim"),
	)).
		WithDirectory("/app", dag.CurrentModule().Source().Directory("linear-agent")).
		WithWorkdir("/app").
		WithExec([]string{"npm", "ci"})
}

// LinearAgentSlim builds the same linear-agent app directly on node:22-slim
// instead of layering Node+claude onto a debian base. Not what gets
// published (PublishLinearAgent uses LinearAgent) -- this is for quickly
// booting the app to check config end-to-end without the extra claude
// layer a config smoke test doesn't need.
func (m *AgentPlugins) LinearAgentSlim(
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
func (m *AgentPlugins) CheckLinearAgent(ctx context.Context) error {
	out, err := m.LinearAgent("").
		WithExec([]string{"npm", "test"}).
		Stdout(ctx)
	if err != nil {
		return err
	}
	return assertContains(out, "# fail 0")
}

// PublishLinearAgent pushes the built linear-agent app to
// ghcr.io/null-hype/devenv-linear-agent:<tag>. amd64 only, matching
// devenv-base's own PublishLinearAgent -- the box it deploys to is amd64.
// No entrypoint is set -- start-linear-agent.sh runs the server once the
// box is up.
func (m *AgentPlugins) PublishLinearAgent(
	ctx context.Context,
	tag string,
	githubUser string,
	githubToken *dagger.Secret,
) (string, error) {
	built := m.LinearAgent("linux/amd64").
		WithExec([]string{"npm", "run", "build"})

	return dag.Container().
		WithRegistryAuth("ghcr.io", githubUser, githubToken).
		Publish(ctx, "ghcr.io/null-hype/devenv-linear-agent:"+tag, dagger.ContainerPublishOpts{
			PlatformVariants: []*dagger.Container{built},
		})
}

// assertContains returns an error if out does not contain substr.
func assertContains(out, substr string) error {
	if !strings.Contains(out, substr) {
		return fmt.Errorf("expected output to contain %q, got: %s", substr, out)
	}
	return nil
}

// CheckLinearAgentWebhookScripts asserts the ported webhook-check and
// start scripts are present, executable and syntactically valid. It can't
// exercise a real run in CI -- that needs a live linear-agent process (and,
// for the live variant, real DNS/tailscale/Pass secrets) -- so this only
// catches shell syntax errors and packaging mistakes, mirroring
// CheckKeepalive's approach to the sibling keepalive scripts (JIN-106).
// +check
func (m *AgentPlugins) CheckLinearAgentWebhookScripts(ctx context.Context) error {
	scripts := dag.CurrentModule().Source().Directory("scripts")
	_, err := dag.Container().
		From("debian:bookworm-slim").
		WithDirectory("/scripts", scripts).
		WithExec([]string{"bash", "-n", "/scripts/start-linear-agent.sh"}).
		WithExec([]string{"bash", "-n", "/scripts/check-linear-agent-webhook.sh"}).
		WithExec([]string{"bash", "-n", "/scripts/check-linear-agent-webhook-live.sh"}).
		WithExec([]string{"sh", "-c", "test -x /scripts/start-linear-agent.sh && test -x /scripts/check-linear-agent-webhook.sh && test -x /scripts/check-linear-agent-webhook-live.sh"}).
		Stdout(ctx)
	return err
}
