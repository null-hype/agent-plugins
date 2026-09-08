package main

import (
	"context"

	"dagger/bountybench-dagger-langchain/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "langchain"
	bountyDir       = "bounties/bounty_0"
)

type BountybenchDaggerLangchain struct{}

// Source clones bountybench/bountytasks and initializes the langchain task's
// codebase submodule, returning the langchain/ directory. It dynamically
// extracts the vulnerable commit from bounty_metadata.json and checks it out.
func (m *BountybenchDaggerLangchain) Source() *dagger.Directory {
	return dag.Container().
		From("alpine/git:latest").
		WithExec([]string{"apk", "add", "jq"}).
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
		WithWorkdir("/src/repo/" + taskDir).
		WithExec([]string{"sh", "-c", "COMMIT=$(jq -r .vulnerable_commit " + bountyDir + "/bounty_metadata.json) && cd codebase && git fetch --depth 1 origin $COMMIT && git checkout $COMMIT"}).
		Directory("/src/repo/" + taskDir)
}

// appContainer provides a standard language base image since this bounty
// lacks a Dockerfile or docker-compose.yml. It sets up the python environment.
func (m *BountybenchDaggerLangchain) appContainer(src *dagger.Directory) *dagger.Container {
	return dag.Container().
		// Python 3.9 is required according to the install_command in metadata.json
		From("python:3.9-slim").
		WithExec([]string{"apt-get", "update"}).
		WithExec([]string{"apt-get", "install", "-y", "curl", "build-essential"}).
		WithDirectory("/app/codebase", src.Directory("codebase")).
		WithDirectory("/app/bounties/bounty_0/exploit_files", src.Directory("bounties/bounty_0/exploit_files")).
		WithDirectory("/app/bounties/bounty_0/verify_files", src.Directory("bounties/bounty_0/verify_files")).
		WithWorkdir("/app").
		// Install dependencies required by the application
		WithExec([]string{"pip", "install", "-e", "codebase/libs/core"}).
		WithExec([]string{"pip", "install", "-e", "codebase/libs/langchain"}).
		WithExec([]string{"pip", "install", "--no-cache-dir", "sentence-transformers"}).
		WithExec([]string{"pip", "install", "--no-cache-dir", "faiss-cpu==1.7.4"})
}

// Serve doesn't run any long-running services for this bounty (it's a library),
// but we return the appContainer to satisfy the structural requirement.
func (m *BountybenchDaggerLangchain) Serve() *dagger.Service {
	src := m.Source()
	return m.appContainer(src).
		WithExec([]string{"sleep", "infinity"}).
		AsService()
}

// Bootstrap builds the langchain bounty_0 task, confirms it builds and can run the exploit
// exactly as bountybench expects.
func (m *BountybenchDaggerLangchain) Bootstrap(ctx context.Context) (string, error) {
	src := m.Source()

	ctr := m.appContainer(src).
		WithWorkdir("/app/" + bountyDir + "/exploit_files")

	script := `set -e

echo "--- replaying bounty_0 exploit ---"
bash exploit.sh

echo "--- verifying exploit success ---"
cd ../verify_files
bash verify.sh
`

	return ctr.WithExec([]string{"sh", "-c", script}).Stdout(ctx)
}
