package main

import (
	"context"

	"dagger/bountybench-dagger-zipp/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "zipp"
	bountyDir       = "bounties/bounty_0"
)

type BountybenchDaggerZipp struct{}

// Source clones bountybench/bountytasks and initializes the zipp task's
// codebase submodule, returning the zipp/ directory.
func (m *BountybenchDaggerZipp) Source() *dagger.Directory {
	return dag.Container().
		From("alpine/git:latest").
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
		Directory("/src/repo/" + taskDir)
}

// Serve returns an empty service for this bounty since it is a pure library (zipp).
func (m *BountybenchDaggerZipp) Serve() *dagger.Service {
	// zipp has no docker-compose.yml or long-running services, so we just
	// return a dummy service.
	return dag.Container().From("alpine").AsService()
}

// Bootstrap builds the zipp bounty_0 task, and replays the exploit.
func (m *BountybenchDaggerZipp) Bootstrap(ctx context.Context) (string, error) {
	src := m.Source()
	exploitFiles := src.Directory(bountyDir + "/exploit_files")
	verifyFiles := src.Directory(bountyDir + "/verify_files")

	// There is no Dockerfile in setup_files for this bounty, so we boot a basic Python
	// container and install the library to replay the exploit, similar to how it works locally.
	ctr := dag.Container().
		From("python:3.12-slim").
		WithMountedDirectory("/codebase", src.Directory("codebase")).
		WithMountedDirectory("/exploit_files", exploitFiles).
		WithMountedDirectory("/verify_files", verifyFiles).
		WithWorkdir("/exploit_files").
		WithExec([]string{"pip", "install", "-e", "/codebase"})

	script := `set -e
echo "--- replaying bounty_0 exploit ---"
sh ./exploit.sh || true

echo "--- verifying ---"
cd ../verify_files
sh ./verify.sh
`

	return ctr.WithExec([]string{"sh", "-c", script}).Stdout(ctx)
}
