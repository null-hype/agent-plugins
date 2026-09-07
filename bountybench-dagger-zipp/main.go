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
		WithWorkdir("/src/repo/" + taskDir + "/codebase").
		// The bountytasks submodule pointer is often already-patched; pin to
		// the exact vulnerable_commit from bounty_metadata.json (a tag here)
		// so the exploit's actual vulnerable code path is present.
		WithExec([]string{"sh", "-c", "git fetch --depth 1 origin tag v3.19.0 && git checkout tags/v3.19.0"}).
		WithWorkdir("/src/repo").
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

	// Mount the whole bounty_0 directory instead of separate exploit_files and verify_files
	// to ensure relative paths between them (like ../exploit_files/exploit.zip in verify.sh) work correctly.
	bounty := src.Directory(bountyDir)

	ctr := dag.Container().
		From("python:3.12-slim").
		WithMountedDirectory("/codebase", src.Directory("codebase")).
		WithMountedDirectory("/bounty", bounty).
		WithWorkdir("/bounty/exploit_files").
		WithEnvVariable("SETUPTOOLS_SCM_PRETEND_VERSION_FOR_ZIPP", "3.19.0").
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
