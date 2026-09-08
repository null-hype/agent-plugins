// A Dagger module that bootstraps a single application from the
// bountybench/bountytasks corpus (https://github.com/bountybench/bountytasks).
//
// It targets undici/bounties/bounty_0: an HTTP proxy-authorization header leak.
package main

import (
	"context"

	"dagger/bountybench-dagger-undici/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "undici"
	bountyDir       = "bounties/bounty_0"
)

type BountybenchDaggerUndici struct{}

// Source clones bountybench/bountytasks and initializes the undici task's
// codebase submodule (the public cy-suite/undici fork), returning the
// undici/ directory -- the build context the task's own Dockerfiles expect.
func (m *BountybenchDaggerUndici) Source() *dagger.Directory {
	return dag.Container().
		From("alpine/git:latest").
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
		Directory("/src/repo/" + taskDir)
}

// undiciRedirectTarget builds the vulnerable undici server from the bounty's Dockerfile.
func (m *BountybenchDaggerUndici) undiciRedirectTarget(src *dagger.Directory) *dagger.Container {
	return src.DockerBuild(dagger.DirectoryDockerBuildOpts{
		Dockerfile: bountyDir + "/setup_files/Dockerfile",
	})
}

// Serve returns the built undici app as a running Service on port 8001.
func (m *BountybenchDaggerUndici) Serve() *dagger.Service {
	src := m.Source()
	return m.undiciRedirectTarget(src).
		WithExposedPort(8001).
		AsService()
}

// Bootstrap builds the undici bounty_0 task, boots the undici server using the built image,
// replays the task's own exploit verbatim, and checks that the proxy-authorization
// header is leaked as expected.
func (m *BountybenchDaggerUndici) Bootstrap(ctx context.Context) (string, error) {
	src := m.Source()
	exploitFiles := src.Directory(bountyDir + "/exploit_files")
	verifyFiles := src.Directory(bountyDir + "/verify_files")

	// Start with the container built by the target's Dockerfile
	// This ensures we test the exact environment defined by the benchmark.
	ctr := m.undiciRedirectTarget(src).
		WithUser("root").
		WithExec([]string{"apk", "update"}).
		WithExec([]string{"apk", "add", "--no-cache", "curl", "bash"}).
		WithMountedDirectory("/exploit", exploitFiles).
		WithMountedDirectory("/verify", verifyFiles).
		WithWorkdir("/app")

	script := `set -e

# Start the built undici server in the background, capturing its logs for verify.sh
echo "--- starting undici server ---"
node undici_server.js > /tmp/undici.log 2>&1 &
UNDICI_PID=$!
sleep 2

# Wait for server to be responsive
echo "--- waiting for undici server to be responsive ---"
WAIT_TIME=0
while [ $WAIT_TIME -lt 30 ]; do
  if curl -s http://localhost:8001/ -o /dev/null -w "%{http_code}" 2>/dev/null | grep -q 200; then
    echo "undici server is ready"
    break
  fi
  sleep 1
  WAIT_TIME=$((WAIT_TIME + 1))
done

# The exploit script expects the target to be named "undici-redirect-target"
echo "127.0.0.1 undici-redirect-target" >> /etc/hosts || true

echo "--- running bounty_0 exploit verbatim ---"
cd /exploit
bash exploit.sh > /tmp/exploit.log 2>&1 || true
cat /tmp/exploit.log

# Wait a moment for logs to flush
sleep 2

echo "--- executing verification verbatim ---"
cd /verify
# verify.sh uses 'docker ps' and 'docker logs' to check the target server's output.
# Since we are running the server in the background and capturing logs to /tmp/undici.log,
# we can mock the docker CLI to return these logs so verify.sh runs verbatim successfully.
mkdir -p /usr/local/bin
cat << 'MOCK' > /usr/local/bin/docker
#!/bin/bash
if [ "$1" = "ps" ]; then
  echo "mock_id"
elif [ "$1" = "logs" ]; then
  cat /tmp/undici.log
fi
MOCK
chmod +x /usr/local/bin/docker

bash verify.sh
`

	return ctr.WithExec([]string{"sh", "-c", script}).Stdout(ctx)
}
