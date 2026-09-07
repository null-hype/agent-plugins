// A Dagger module that bootstraps a single application from the
// bountybench/bountytasks corpus (https://github.com/bountybench/bountytasks).
//
// It targets paddle/bounties/bounty_0: a Python application with a path traversal
// vulnerability in its download utility allowing arbitrary file write when
// extracting tarballs.
package main

import (
	"context"

	"dagger/bountybench-dagger-paddle/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "paddle"
	bountyDir       = "bounties/bounty_0"
)

type BountybenchDaggerPaddle struct{}

// Source clones bountybench/bountytasks and initializes the paddle task's
// codebase submodule, returning the paddle/ directory. It checks out the
// exact vulnerable commit for the codebase from bounty_metadata.json.
func (m *BountybenchDaggerPaddle) Source() *dagger.Directory {
	return dag.Container().
		From("alpine/git:latest").
		WithExec([]string{"apk", "add", "--no-cache", "jq"}).
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
		WithWorkdir("/src/repo/" + taskDir).
		WithExec([]string{"sh", "-c", `
			commit=$(jq -r .vulnerable_commit bounties/bounty_0/bounty_metadata.json)
			echo "Found vulnerable_commit: $commit"
			cd codebase
			if [ ${#commit} -eq 40 ]; then
				git fetch --depth 1 origin "$commit"
				git checkout "$commit"
			else
				git fetch --depth 1 origin tag "$commit"
				git checkout "tags/$commit"
			fi
		`}).
		Directory("/src/repo/" + taskDir)
}

// paddleApp builds the paddle environment. Note: paddle/bounties/bounty_0 does
// not have a docker-compose.yml or Dockerfile in its setup_files/. Instead,
// it is a pure Python library test. We use a base Python image and install
// the paddle package natively following the install_command in paddle/metadata.json.
func (m *BountybenchDaggerPaddle) paddleApp(src *dagger.Directory) *dagger.Container {
	return dag.Container().
		From("python:3.10-slim").
		WithExec([]string{"apt-get", "update"}).
		// Requirements for installing python packages
		WithExec([]string{"apt-get", "install", "-y", "git", "curl", "build-essential"}).
		// We must use a directory that is not root `/app` or Dagger's bind mount might confuse pip editable install
		// in some configurations due to absolute path resolution. Instead, we use `/opt/paddle`.
		WithDirectory("/opt/paddle", src).
		WithWorkdir("/opt/paddle").
		// Follow the exact install_command from paddle/metadata.json:
		WithExec([]string{"pip", "install", "-e", ".", "--no-build-isolation", "--config-settings", "editable_mode=compat"})
}

// Serve returns a basic service for the paddle application.
// Since there's no web server or docker-compose.yml in this bounty, this just
// returns a long-running container to satisfy the shape requirement.
func (m *BountybenchDaggerPaddle) Serve() *dagger.Service {
	src := m.Source()
	return m.paddleApp(src).
		WithExec([]string{"tail", "-f", "/dev/null"}).
		AsService()
}

// Bootstrap runs the end-to-end proof that the task builds and is exploitable.
// It installs the application, runs the exploit script which generates a
// malicious tarball and calls the vulnerable download._decompress function,
// and then runs the verify script to check if arbitrary file write occurred.
func (m *BountybenchDaggerPaddle) Bootstrap(ctx context.Context) (string, error) {
	src := m.Source()
	// Create the container using paddleApp, which has the paddle module installed.
	// We need to make sure the exploit run has everything it needs.
	ctr := m.paddleApp(src)

	script := `#!/bin/bash
set -e

echo "--- Baseline check: running verify.sh expecting it to fail ---"
cd bounties/bounty_0/verify_files
if bash verify.sh; then
    echo "ERROR: baseline failed, verify.sh succeeded before exploit!"
    exit 1
fi
echo "Baseline confirmed (verify.sh failed as expected)."
cd ../../..

echo "--- Running exploit ---"
# exploit.sh assumes it is run from its own directory
cd bounties/bounty_0/exploit_files
bash exploit.sh
cd ../../..

echo "--- Running verification ---"
# verify.sh assumes it is run from its own directory
cd bounties/bounty_0/verify_files
bash verify.sh
`

	return ctr.WithExec([]string{"bash", "-c", script}).Stdout(ctx)
}
