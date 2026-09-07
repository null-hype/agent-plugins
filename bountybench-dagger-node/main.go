package main

import (
	"context"

	"dagger/bountybench-dagger-node/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "node"
	bountyDir       = "bounties/bounty_0"
)

type BountybenchDaggerNode struct{}

// Source clones bountybench/bountytasks and initializes the node task's
// codebase submodule, explicitly checking out the vulnerable commit v21.0.0.
// It also creates the flag file required by setup_files/Dockerfile and verify.sh.
func (m *BountybenchDaggerNode) Source() *dagger.Directory {
	return dag.Container().
		From("alpine/git:latest").
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
		// The bare submodule pointer is often already-patched. Dynamically read the
		// vulnerable commit from bounty_metadata.json and check it out explicitly.
		WithWorkdir("/src/repo/"+taskDir).
		WithExec([]string{"sh", "-c", "apk add jq && COMMIT=$(jq -r .vulnerable_commit bounties/bounty_0/bounty_metadata.json) && cd codebase && git fetch origin $COMMIT && git checkout FETCH_HEAD"}).
		Directory("/src/repo/"+taskDir).
		// Generate the flag expected by the task's docker setup and verification scripts.
		WithNewFile(bountyDir+"/setup_files/flag", "dagger-dummy-flag-1234567890")
}

// cmdServer builds the vulnerable node-app service.
// Because setup_files/Dockerfile relies on bountybench-node:latest which is not in
// a registry, we build the root Dockerfile first, then procedurally apply the setup steps.
func (m *BountybenchDaggerNode) cmdServer(src *dagger.Directory) *dagger.Container {
	base := src.DockerBuild(dagger.DirectoryDockerBuildOpts{
		Dockerfile: "Dockerfile",
	})
	return base.
		WithExec([]string{"apk", "add", "--no-cache", "python3", "py3-pip", "curl"}).
		WithExec([]string{"pip", "install", "--break-system-packages", "flask"}).
		WithFile("/etc/flag", src.File(bountyDir+"/setup_files/flag")).
		WithFile("/server.py", src.File(bountyDir+"/setup_files/server.py")).
		WithWorkdir("/").
		WithDefaultArgs([]string{"python", "server.py"})
}

// Serve wires the cmd-server as a service exactly as the task's docker-compose.yml does.
func (m *BountybenchDaggerNode) Serve() *dagger.Service {
	src := m.Source()
	return m.cmdServer(src).
		WithExposedPort(2345).
		AsService()
}

// Bootstrap boots the services, confirms a baseline, replays exploit.sh verbatim,
// and checks the effect using verify.sh verbatim.
func (m *BountybenchDaggerNode) Bootstrap(ctx context.Context) (string, error) {
	src := m.Source()

	ctr := dag.Container().
		From("python:3.12-slim").
		WithExec([]string{"apt-get", "update"}).
		WithExec([]string{"apt-get", "install", "-y", "curl"}).
		WithExec([]string{"pip", "install", "requests"}).
		WithMountedDirectory("/app", src.Directory(bountyDir)).
		WithWorkdir("/app").
		// Wire the vulnerable application as 'node-app' to match docker-compose logic
		WithServiceBinding("node-app", m.Serve())

	script := `set -e
echo "--- baseline: server is reachable ---"
# We wait for cmd-server to be ready and verify basic execution baseline
code=$(curl -s -o /dev/null -w '%{http_code}' "http://node-app:2345/?cmd=console.log('baseline')")
echo "HTTP $code"
[ "$code" = "200" ] || { echo "expected baseline check to return 200, got $code"; exit 1; }

echo "--- replaying bounty_0 exploit ---"
cd /app/exploit_files
# Run exploit.sh verbatim. Passing 'true' sets HOSTNAME='node-app'.
bash exploit.sh true

sleep 2
echo "--- verifying backend recorded the flag ---"
cd /app/verify_files
# Run verify.sh verbatim. It checks ../setup_files/flag against ../flag.
bash verify.sh
`
	return ctr.WithExec([]string{"sh", "-c", script}).Stdout(ctx)
}
