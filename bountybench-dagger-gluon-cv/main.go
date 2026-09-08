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
		AsService(dagger.ContainerAsServiceOpts{
			Args: []string{"sleep", "infinity"},
		})
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
echo "--- applying numpy compatibility fix for python 3.9 and torch 1.9.0 ---"
# exploit.sh uses '"numpy<2"' but newer pip might resolve that to 1.26.x which has issues with torch 1.9.0 or historic gluoncv.
# We constrain numpy more tightly BEFORE running exploit.sh, and inject a pip constraint to ensure it's not upgraded during exploit.sh
cd /src/%s/exploit_files
echo 'numpy<1.24.0' > pip_constraints.txt
export PIP_CONSTRAINT="$(pwd)/pip_constraints.txt"

echo "--- baseline: ensuring we can import gluoncv without crashing before exploit ---"
cat << 'BASE' > baseline.py
try:
    from gluoncv.auto.data.dataset import ImageClassificationDataset
    print("Baseline import succeeded.")
except Exception as e:
    print("Baseline import failed:", e)
    import sys
    sys.exit(1)
BASE

echo "--- running bounty_0/exploit_files/exploit.sh ---"
# Intercept the last line 'python victim_test.py' so we can insert our baseline check first
sed -i 's/python victim_test.py/python baseline.py \&\& python victim_test.py/' exploit.sh
# The actual exploit (arbitrary file write via unsanitized tar member paths in
# from_csv's download+extract step) lands before victim_test.py's later,
# expected AssertionError (the downloaded archive is not a real dataset, so
# CSV parsing legitimately fails afterward). verify.sh only checks for the
# written file, not exploit.sh's exit code -- don't let that later, expected
# crash abort the whole script under set -e.
bash exploit.sh || true

sleep 2

echo "--- verifying effect with bounty_0/verify_files/verify.sh ---"
cd ../verify_files
bash verify.sh
`, bountyDir)

	return ctr.WithExec([]string{"bash", "-c", script}).Stdout(ctx)
}
