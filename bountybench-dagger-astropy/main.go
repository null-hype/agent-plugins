// A Dagger module that bootstraps a single application from the
// bountybench/bountytasks corpus (https://github.com/bountybench/bountytasks).
//
// It targets astropy/bounties/bounty_0: a vulnerability in Astropy
// where malformed input can cause RCE via `TransformGraph`.
// Since Astropy is a library, there is no docker-compose.yml or running service.
// Serve returns a dummy HTTP service, and Bootstrap runs the installation,
// exploit, and verification steps in a single container.
package main

import (
	"context"
	"encoding/json"

	"dagger/bountybench-dagger-astropy/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "astropy"
	bountyDir       = "bounties/bounty_0"
)

type BountybenchDaggerAstropy struct{}

// Source clones bountybench/bountytasks and initializes the astropy task's
// codebase submodule. It reads the vulnerable commit from bounty_metadata.json
// and checks out that specific commit in the codebase submodule.
func (m *BountybenchDaggerAstropy) Source(ctx context.Context) (*dagger.Directory, error) {
	// First, clone the repo to get the bounty_metadata.json
	clonedRepo := dag.Container().
		From("alpine/git:latest").
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"})

	metadataContent, err := clonedRepo.File("/src/repo/" + taskDir + "/" + bountyDir + "/bounty_metadata.json").Contents(ctx)
	if err != nil {
		return nil, err
	}

	var metadata struct {
		VulnerableCommit string `json:"vulnerable_commit"`
	}
	if err := json.Unmarshal([]byte(metadataContent), &metadata); err != nil {
		return nil, err
	}

	// Now check out the specific commit in the codebase submodule *before* extracting the directory
	// so that the .git folder context is still valid.
	return clonedRepo.
		WithWorkdir("/src/repo/" + taskDir + "/codebase").
		WithExec([]string{"git", "fetch", "origin", metadata.VulnerableCommit}).
		WithExec([]string{"git", "checkout", "FETCH_HEAD"}).
		Directory("/src/repo/" + taskDir), nil
}

// Serve returns a dummy service since Astropy is a library without a
// dedicated service setup in bounty_0. It runs a simple python HTTP server.
// The task doesn't have a docker-compose.yml to reproduce.
func (m *BountybenchDaggerAstropy) Serve(ctx context.Context) (*dagger.Service, error) {
	src, err := m.Source(ctx)
	if err != nil {
		return nil, err
	}
	return dag.Container().
		From("python:3.10-slim").
		WithMountedDirectory("/app", src).
		WithWorkdir("/app").
		WithExec([]string{"python3", "-m", "http.server", "8000"}).
		WithExposedPort(8000).
		AsService(), nil
}

// Bootstrap builds the astropy bounty_0 task, confirms a baseline (that the exploit
// hasn't run yet), runs the verbatim exploit script, and verifies the exploit succeeded
// using the logic from verify.sh.
func (m *BountybenchDaggerAstropy) Bootstrap(ctx context.Context) (string, error) {
	src, err := m.Source(ctx)
	if err != nil {
		return "", err
	}

	// This task has no Dockerfile under setup_files, so we provision a basic Python
	// container to execute the provided scripts directly. The installation of Astropy
	// itself is handled within exploit.sh, but we need build-essential for pip install.
	ctr := dag.Container().
		From("python:3.10-slim").
		WithExec([]string{"apt-get", "update"}).
		WithExec([]string{"apt-get", "install", "-y", "build-essential"}).
		WithMountedDirectory("/astropy", src).
		WithWorkdir("/astropy/" + bountyDir)

	script := `set -e
echo "--- confirming baseline (verify should fail before exploit) ---"
cd verify_files
if bash verify.sh; then
  echo "baseline check failed: verify.sh succeeded before exploit!"
  exit 1
else
  echo "baseline check passed: verify.sh failed as expected."
fi
cd ..

echo "--- replaying bounty_0 exploit ---"
cd exploit_files
bash exploit.sh
cd ..

echo "--- verifying exploit success ---"
cd verify_files
bash verify.sh
`

	return ctr.WithExec([]string{"bash", "-c", script}).Stdout(ctx)
}
