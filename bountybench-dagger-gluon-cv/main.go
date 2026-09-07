package main

import (
	"context"
	"fmt"

	"dagger/bountybench-dagger-gluon-cv/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "gluon-cv"
	bountyDir       = "bounties/bounty_0"
)

type BountybenchDaggerGluonCv struct{}

// Source clones bountybench/bountytasks and initializes the gluon-cv task's
// codebase submodule, dynamically checking out the vulnerable commit, returning the
// gluon-cv/ directory.
func (m *BountybenchDaggerGluonCv) Source() *dagger.Directory {
	return dag.Container().
		From("alpine/git:latest").
		WithExec([]string{"apk", "add", "jq"}).
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
		WithExec([]string{"sh", "-c", fmt.Sprintf(`
			VULN_COMMIT=$(jq -r '.vulnerable_commit' %s/%s/bounty_metadata.json)
			cd %s/codebase
			if echo "$VULN_COMMIT" | grep -q '^[0-9a-f]\{40\}$'; then
				git fetch --depth 1 origin "$VULN_COMMIT"
				git checkout "$VULN_COMMIT"
			else
				git fetch --depth 1 origin tag "$VULN_COMMIT"
				git checkout tags/"$VULN_COMMIT"
			fi
		`, taskDir, bountyDir, taskDir)}).
		Directory("/src/repo/" + taskDir)
}

// Serve returns an empty service since this bounty has no docker-compose.yml
// and targets a vulnerable Python library rather than a web service.
func (m *BountybenchDaggerGluonCv) Serve() *dagger.Service {
	return dag.Container().
		From("python:3.9-slim").
		WithExec([]string{"sleep", "infinity"}).
		AsService()
}

// Bootstrap builds the environment for gluon-cv, replays the exploit,
// and verifies the vulnerability was successfully triggered.
func (m *BountybenchDaggerGluonCv) Bootstrap(ctx context.Context) (string, error) {
	src := m.Source()

	// We create a container running bash and matching exploit.sh requirements.
	// We don't use DockerBuild because this bounty has no Dockerfile in setup_files/ (checked earlier).
	// We use python 3.9 because exploit.sh installs torch==1.9.0 which is not available for newer python versions.
	ctr := dag.Container().
		From("python:3.9-slim").
		WithExec([]string{"apt-get", "update"}).
		WithExec([]string{"apt-get", "install", "-y", "bash"}).
		WithDirectory("/src", src)

	script := fmt.Sprintf(`set -e
echo "--- running bounty_0/exploit_files/exploit.sh ---"
cd /src/%s/exploit_files
bash exploit.sh

sleep 2

echo "--- verifying effect with bounty_0/verify_files/verify.sh ---"
cd ../verify_files
bash verify.sh
`, bountyDir)

	return ctr.WithExec([]string{"bash", "-c", script}).Stdout(ctx)
}
