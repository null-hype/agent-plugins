package main

import (
	"context"
	"encoding/json"
	"fmt"

	"dagger/bountybench-dagger-scikit-learn/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "scikit-learn"
	bountyDir       = "bounties/bounty_0"
)

type BountybenchDaggerScikitLearn struct{}

// Source clones bountybench/bountytasks and initializes the scikit-learn task's
// codebase submodule, dynamically reading the vulnerable commit from bounty_metadata.json,
// returning the scikit-learn/ directory.
func (m *BountybenchDaggerScikitLearn) Source(ctx context.Context) (*dagger.Directory, error) {
	// First fetch the bountytasks repo without checking out the submodule deeply,
	// so we can read bounty_metadata.json
	repo := dag.Container().
		From("alpine/git:latest").
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		Directory("/src/repo")

	metadataBytes, err := repo.File(taskDir + "/" + bountyDir + "/bounty_metadata.json").Contents(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to read metadata: %w", err)
	}

	var metadata map[string]interface{}
	if err := json.Unmarshal([]byte(metadataBytes), &metadata); err != nil {
		return nil, fmt.Errorf("failed to parse metadata: %w", err)
	}

	vulnCommit, ok := metadata["vulnerable_commit"].(string)
	if !ok {
		return nil, fmt.Errorf("vulnerable_commit missing or not a string")
	}

	// Now proceed to fetch the correct commit for the submodule
	return dag.Container().
		From("alpine/git:latest").
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
		WithWorkdir("/src/repo/" + taskDir + "/codebase").
		// Try fetching it as a commit directly in case it's not a tag
		WithExec([]string{"git", "fetch", "origin", vulnCommit, "--depth", "1"}).
		WithExec([]string{"git", "checkout", "FETCH_HEAD"}).
		Directory("/src/repo/" + taskDir), nil
}

// appContainer provides the environment: this bounty has no docker-compose.yml
// or Dockerfile (setup_files/ only carries an empty setup_bounty_env.sh) --
// it's a plain library exploit, so we just install Python and mount the
// whole scikit-learn/ task directory (exploit.sh installs the codebase
// itself via a relative "../../../codebase" pip install -e).
func (m *BountybenchDaggerScikitLearn) appContainer(ctx context.Context) (*dagger.Container, error) {
	src, err := m.Source(ctx)
	if err != nil {
		return nil, err
	}

	return dag.Container().
		From("python:3.11-slim").
		WithExec([]string{"apt-get", "update"}).
		WithExec([]string{"apt-get", "install", "-y", "build-essential"}).
		WithMountedDirectory("/task", src).
		WithWorkdir("/task"), nil
}

// Serve returns a basic service for the app. Since there is no web server
// for this bounty, we just return a sleeping container to satisfy the interface.
func (m *BountybenchDaggerScikitLearn) Serve(ctx context.Context) (*dagger.Service, error) {
	app, err := m.appContainer(ctx)
	if err != nil {
		return nil, err
	}
	return app.
		WithExec([]string{"sleep", "infinity"}).
		AsService(), nil
}

// Bootstrap builds the scikit-learn bounty_0 task, confirms a baseline, runs the task's own exploit
// (exploit.py via exploit.sh) and checks its verification file in one pipeline,
// mirroring bounty_0's exploit_files/exploit.sh and verify_files/verify.sh.
func (m *BountybenchDaggerScikitLearn) Bootstrap(ctx context.Context) (string, error) {
	ctr, err := m.appContainer(ctx)
	if err != nil {
		return "", err
	}

	script := fmt.Sprintf(`set -e
echo "--- confirming baseline (should fail verification) ---"
cd %s/verify_files
if sh verify.sh; then
    echo "ERROR: Baseline verification passed before running the exploit, which is unexpected."
    /bin/false
else
    echo "Baseline check succeeded (verification failed as expected)."
fi

echo "--- replaying bounty_0 exploit ---"
cd ../exploit_files
sh exploit.sh

echo "--- verifying bounty_0 exploit ---"
cd ../verify_files
sh verify.sh
`, bountyDir)

	return ctr.WithExec([]string{"sh", "-c", script}).Stdout(ctx)
}
