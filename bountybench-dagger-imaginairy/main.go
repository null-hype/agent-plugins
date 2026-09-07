package main

import (
	"context"

	"dagger/bountybench-dagger-imaginairy/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "imaginairy"
	bountyDir       = "bounties/bounty_0"
)

type BountybenchDaggerImaginairy struct{}

// Source clones bountybench/bountytasks and initializes the imaginairy task's
// codebase submodule, returning the imaginairy/ directory.
func (m *BountybenchDaggerImaginairy) Source() *dagger.Directory {
	// The vulnerable_commit must be extracted dynamically from bounty_metadata.json
	return dag.Container().
		From("alpine/git:latest").
		WithExec([]string{"apk", "add", "jq"}).
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		// Init submodule but we need to check out the specific commit
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
		WithWorkdir("/src/repo/" + taskDir).
		// dynamically extract the vulnerable commit and check it out
		WithExec([]string{"sh", "-c", "COMMIT=$(jq -r .vulnerable_commit " + bountyDir + "/bounty_metadata.json) && cd codebase && git fetch origin $COMMIT && git checkout $COMMIT"}).
		Directory("/src/repo/" + taskDir)
}

// aimgServer builds the imaginairy server, matching bounty_0's
// docker-compose "aimg-server" service.
func (m *BountybenchDaggerImaginairy) aimgServer(src *dagger.Directory) *dagger.Container {
	return src.DockerBuild(dagger.DirectoryDockerBuildOpts{
		Dockerfile: bountyDir + "/setup_files/Dockerfile",
	})
}

// Serve wires services together exactly as bounty_0's docker-compose.yml does,
// and returns the aimg-server as a running Service on port 8000.
func (m *BountybenchDaggerImaginairy) Serve() *dagger.Service {
	src := m.Source()
	return m.aimgServer(src).
		WithExposedPort(8000).
		AsService()
}

// Bootstrap builds the imaginairy bounty_0 task, boots the server,
// replays the task's own dos.py exploit (via exploit.sh) and checks if the server
// crashed -- an end-to-end proof that the task builds, runs, and is exploitable
// exactly as bountybench expects.
func (m *BountybenchDaggerImaginairy) Bootstrap(ctx context.Context) (string, error) {
	src := m.Source()

	// We need to run exploit.sh verbatim (which hits http://aimg-server:8000)
	// and verify.sh verbatim (which runs pgrep -f "aimg server")
	// Since verify.sh needs to check process, we need to run in a single container just like bountybench-dagger/main.go did for gunicorn.
	// But how do we make exploit.sh verbatim hit aimg-server? We can map 127.0.0.1 to aimg-server in /etc/hosts!

	// Use the real built container!
	ctr := m.aimgServer(src).
		WithUser("root"). // switch to root to install test dependencies
		WithExec([]string{"apt-get", "update"}).
		WithExec([]string{"apt-get", "install", "-y", "--no-install-recommends", "procps"}). // curl is already in Dockerfile
		// Also install requests for the exploit script
		WithExec([]string{"pip", "install", "--no-cache-dir", "requests"}).
		WithMountedDirectory("/bountytask", src).
		WithMountedFile("/etc/hosts", dag.Directory().
			WithNewFile("hosts", "127.0.0.1 localhost\n127.0.0.1 aimg-server\n").
			File("hosts"))

	// Replicate exactly what happens in verify.sh and exploit.sh
	script := `set -e
# map aimg-server to localhost so verbatim exploit.sh works

# Start the server in the background
aimg server > /tmp/aimg_server.log 2>&1 &

# Wait for server to be ready
echo "Waiting for server to be ready..."
for i in $(seq 1 30); do
    if curl -s http://localhost:8000/api/stablestudio/generate > /dev/null; then
        echo "Server is up!"
        break
    fi
    sleep 1
done

echo "--- replaying bounty_0 dos exploit ---"
cd /bountytask/bounties/bounty_0/exploit_files
# Run exploit verbatim
bash exploit.sh || true

sleep 3

echo "--- running verify.sh ---"
cd /bountytask/bounties/bounty_0
bash verify.sh
`

	return ctr.WithExec([]string{"sh", "-c", script}).Stdout(ctx)
}
