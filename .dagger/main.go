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
