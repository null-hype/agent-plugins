package main

import (
	"context"
	"fmt"

	"dagger/bountybench-dagger-kedro/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "kedro"
	bountyDir       = "bounties/bounty_0"
)

type BountybenchDaggerKedro struct{}

// Source clones bountybench/bountytasks and initializes the kedro task's
// codebase submodule (the public cy-suite/kedro fork), checking out the
// specific vulnerable_commit.
func (m *BountybenchDaggerKedro) Source() *dagger.Directory {
	return dag.Container().
		From("alpine/git:latest").
		WithExec([]string{"apk", "add", "jq"}).
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
		WithWorkdir("/src/repo/" + taskDir).
		WithExec([]string{"sh", "-c", `
			COMMIT=$(jq -r .vulnerable_commit bounties/bounty_0/bounty_metadata.json)
			echo "Checking out vulnerable commit: $COMMIT"
			cd codebase
			git fetch origin "$COMMIT"
			git checkout FETCH_HEAD
		`}).
		Directory("/src/repo/" + taskDir)
}

// kedroApp builds the vulnerable app environment. Since there is no Dockerfile
// in setup_files, we emulate a DockerBuild using a standard container that
// meets the generic requirements of bounty_0. We don't use src.DockerBuild
// because the Dockerfile simply does not exist. (If one existed, we would use it).
func (m *BountybenchDaggerKedro) kedroApp(src *dagger.Directory) *dagger.Container {
	return dag.Container().
		From("python:3.12-slim").
		WithExec([]string{"apt-get", "update"}).
		WithExec([]string{"apt-get", "install", "-y", "curl", "bash"}).
		WithDirectory("/app", src).
		WithWorkdir("/app")
}

// Serve returns an empty service since kedro bounty_0 has no docker-compose.yml.
func (m *BountybenchDaggerKedro) Serve() *dagger.Service {
	src := m.Source()
	return m.kedroApp(src).
		WithExec([]string{"sleep", "infinity"}).
		AsService()
}

// Bootstrap builds the kedro bounty_0 task, runs the task's exploit, and checks
// the verification condition to prove it's exploitable exactly as expected.
// There is no docker-compose.yml so we don't boot background services.
func (m *BountybenchDaggerKedro) Bootstrap(ctx context.Context) (string, error) {
	src := m.Source()

	// According to instruction: boot the same services, confirm baseline, replay exploit.
	// Since there are no background services to boot in this specific task, we just set up the codebase.
	// The exploit.sh pip installs the codebase and runs exploit.py.
	ctr := dag.Container().
		From("python:3.12-slim").
		WithExec([]string{"apt-get", "update"}).
		WithExec([]string{"apt-get", "install", "-y", "curl", "bash"}).
		WithDirectory("/app", src).
		WithWorkdir("/app")

	script := fmt.Sprintf(`set -e

echo "--- running setup if needed ---"
if [ -f %[1]s/setup_files/setup_bounty_env.sh ]; then
	cd %[1]s/setup_files
	bash setup_bounty_env.sh
	cd /app
fi

echo "--- replaying bounty_0 exploit (exploit.sh) ---"
cd /app/%[1]s/exploit_files
bash exploit.sh

echo "--- verifying backend recorded the hit (verify.sh) ---"
cd /app/%[1]s/verify_files
bash verify.sh
`, bountyDir)

	return ctr.WithExec([]string{"bash", "-c", script}).Stdout(ctx)
}
