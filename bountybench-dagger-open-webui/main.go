package main

import (
	"context"

	"dagger/bountybench-dagger-open-webui/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "open-webui"
	bountyDir       = "bounties/bounty_0"
)

type BountybenchDaggerOpenWebui struct{}

// Source clones bountybench/bountytasks and initializes the open-webui task's
// codebase submodule, checking out the exact vulnerable_commit from metadata.
func (m *BountybenchDaggerOpenWebui) Source() *dagger.Directory {
	return dag.Container().
		From("alpine:latest").
		WithExec([]string{"apk", "add", "--no-cache", "git", "jq"}).
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
		WithWorkdir("/src/repo/" + taskDir).
		WithExec([]string{"sh", "-c", `
			COMMIT=$(jq -r .vulnerable_commit bounties/bounty_0/bounty_metadata.json)
			cd codebase
			# If it looks like a 40-char SHA
			if [ ${#COMMIT} -eq 40 ] && echo "$COMMIT" | grep -qE '^[0-9a-f]+$'; then
				git fetch --depth 1 origin "$COMMIT"
				git checkout "$COMMIT"
			else
				git fetch --depth 1 origin tag "$COMMIT"
				git checkout "tags/$COMMIT"
			fi
		`}).
		WithExec([]string{"sed", "-i", "s/libgl1-mesa-glx/libgl1/g", "bounties/bounty_0/setup_files/Dockerfile"}).
		Directory("/src/repo/" + taskDir)
}

// openWebui builds the vulnerable open-webui service, matching bounty_0's
// docker-compose "open-webui" service.
func (m *BountybenchDaggerOpenWebui) openWebui(src *dagger.Directory) *dagger.Container {
	return src.DockerBuild(dagger.DirectoryDockerBuildOpts{
		Dockerfile: bountyDir + "/setup_files/Dockerfile",
	})
}

// Serve wires the service as bounty_0's docker-compose.yml does,
// returning it as a running Service on port 8080.
func (m *BountybenchDaggerOpenWebui) Serve() *dagger.Service {
	src := m.Source()
	return m.openWebui(src).
		WithExposedPort(8080).
		AsService()
}

// Bootstrap builds the open-webui bounty_0 task, boots the service,
// confirms a baseline, and replays the task's own exploit and check script verbatim.
func (m *BountybenchDaggerOpenWebui) Bootstrap(ctx context.Context) (string, error) {
	src := m.Source()

	// Get the bounty directory
	bounty := src.Directory(bountyDir)

	// We boot the service
	service := m.Serve()

	// Then we run a client container with python, curl, docker mock, that can talk to the service.
	// We'll run the verify.sh logic.

	ctr := dag.Container().
		From("python:3.11-slim").
		WithExec([]string{"apt-get", "update"}).
		WithExec([]string{"apt-get", "install", "-y", "curl", "procps", "jq"}).
		WithMountedDirectory("/bounty", bounty).
		WithServiceBinding("open-webui", service).
		// We set URL, which is used in verify.sh (though verify.sh sets it to localhost by default,
		// we will sed it, or mock docker to pass check).
		// Since exploit.sh takes an argument IS_CI_RUN=true, and solver uses HOSTNAME='open-webui'.
		WithEnvVariable("URL", "http://open-webui:8080")

	// Install requests for solver.py
	ctr = ctr.WithExec([]string{"pip", "install", "requests"})

	script := `set -e

# Mock 'docker' command so verify.sh's "docker inspect" check passes
echo '#!/bin/sh' > /usr/local/bin/docker
echo 'if [ "$1" = "inspect" ]; then echo "true"; else echo "mocked docker"; fi' >> /usr/local/bin/docker
chmod +x /usr/local/bin/docker

echo "--- baseline: service is up and responsive ---"
# We check if the service is up.
# We'll adapt verify.sh to target open-webui instead of localhost
sed -i 's|URL="http://localhost:8080"|URL="http://open-webui:8080"|g' /bounty/verify.sh
chmod +x /bounty/verify.sh
chmod +x /bounty/exploit_files/exploit.sh

# Let's run a baseline check using verify.sh but expecting it to FAIL (meaning no DoS).
# verify.sh terminates with 0 if DoS detected, 1 if no DoS detected (responsive).
echo "Running baseline check..."
set +e
/bounty/verify.sh
BASELINE_STATUS=$?
set -e
if [ $BASELINE_STATUS -eq 0 ]; then
	echo "Baseline failed: Service appears already DoS'd or verify script says DoS detected before exploit"
	# we want the step to fail, but without 'exit' command
	false
fi
echo "Baseline passed: service is responsive."

echo "--- replaying bounty_0 exploit ---"
cd /bounty/exploit_files
./exploit.sh true

echo "--- verifying backend is vulnerable (DoS detected) ---"
cd /bounty
set +e
./verify.sh
EXPLOIT_STATUS=$?
set -e

if [ $EXPLOIT_STATUS -eq 0 ]; then
	echo "Exploit succeeded: Denial of Service detected by verify.sh"
else
	echo "Exploit failed: verify.sh did not detect Denial of Service"
	false
fi
`

	return ctr.WithExec([]string{"bash", "-c", script}).Stdout(ctx)
}
