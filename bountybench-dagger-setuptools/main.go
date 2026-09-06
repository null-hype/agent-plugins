package main

import (
	"context"

	"dagger/bountybench-dagger-setuptools/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "setuptools"
	bountyDir       = "bounties/bounty_0"
)

type BountybenchDaggerSetuptools struct{}

// Source clones bountybench/bountytasks and initializes the setuptools task's
// codebase submodule (the public cy-suite/setuptools fork) to the vulnerable
// commit, returning the setuptools/ directory.
func (m *BountybenchDaggerSetuptools) Source() *dagger.Directory {
	return dag.Container().
		From("alpine/git:latest").
		WithExec([]string{"apk", "add", "--no-cache", "jq"}).
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", taskDir + "/codebase"}).
		WithWorkdir("/src/repo/" + taskDir + "/codebase").
		// Extract the vulnerable_commit from bounty_metadata.json using jq and checkout
		WithExec([]string{"sh", "-c", `git checkout $(jq -r '.vulnerable_commit' ../` + bountyDir + `/bounty_metadata.json)`}).
		Directory("/src/repo/" + taskDir)
}

// setuptoolsApp builds the Python environment for setuptools.
// Note: This specific bounty (setuptools/bounty_0) does not contain a docker-compose.yml
// or a Dockerfile in setup_files/. The setup is just a bash script. We provide a basic
// python environment that runs the exploit.
func (m *BountybenchDaggerSetuptools) setuptoolsApp(src *dagger.Directory) *dagger.Container {
	return dag.Container().
		From("python:3.12-slim").
		WithExec([]string{"apt-get", "update"}).
		WithExec([]string{"apt-get", "install", "-y", "git", "bash"}).
		WithMountedDirectory("/app", src).
		WithWorkdir("/app")
}

// Serve conforms to the required module shape.
func (m *BountybenchDaggerSetuptools) Serve() *dagger.Service {
	src := m.Source()
	return m.setuptoolsApp(src).
		WithExec([]string{"sleep", "infinity"}).
		AsService()
}

// Bootstrap builds the setuptools bounty_0 task, replays the
// task's own exploit and checks the effect verbatim.
func (m *BountybenchDaggerSetuptools) Bootstrap(ctx context.Context) (string, error) {
	src := m.Source()
	ctr := m.setuptoolsApp(src)

	script := `set -e

echo "--- baseline: checking environment before exploit ---"
if [ -f "bounties/bounty_0/exploit_files/attack.txt" ]; then
    echo "Baseline failed: attack.txt already exists"
    false
fi
echo "Environment clean."

echo "--- replaying bounty_0 code injection exploit ---"
cd bounties/bounty_0/exploit_files
# Run the exploit verbatim
bash exploit.sh 2>&1 || true

echo "--- verifying codebase recorded the injected code hit ---"
cd ../verify_files
# Verify verbatim
bash verify.sh
`

	return ctr.WithExec([]string{"sh", "-c", script}).Stdout(ctx)
}
