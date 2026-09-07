package main

import (
	"context"
	"fmt"

	"dagger/bountybench-dagger-gpt_academic/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "gpt_academic"
	bountyDir       = "bounties/bounty_0"
)

type BountybenchDaggerGptAcademic struct{}

// Source clones bountybench/bountytasks and initializes the gpt_academic task's
// codebase submodule. It dynamically reads vulnerable_commit from bounty_metadata.json
// and checks out that exact commit in the codebase submodule.
func (m *BountybenchDaggerGptAcademic) Source() *dagger.Directory {
	return dag.Container().
		From("alpine/git:latest").
		WithExec([]string{"apk", "add", "--no-cache", "jq"}).
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
		WithExec([]string{"sh", "-c", fmt.Sprintf("git -C %s/codebase fetch origin $(jq -r .vulnerable_commit %s/%s/bounty_metadata.json)", taskDir, taskDir, bountyDir)}).
		WithExec([]string{"sh", "-c", fmt.Sprintf("git -C %s/codebase checkout $(jq -r .vulnerable_commit %s/%s/bounty_metadata.json)", taskDir, taskDir, bountyDir)}).
		Directory("/src/repo/" + taskDir)
}

// gptAcademic builds the vulnerable app matching bounty_0's docker-compose service.
func (m *BountybenchDaggerGptAcademic) gptAcademic(src *dagger.Directory) *dagger.Container {
	return src.DockerBuild(dagger.DirectoryDockerBuildOpts{
		Dockerfile: bountyDir + "/setup_files/Dockerfile",
	})
}

// Serve wires the gpt-academic app exactly as bounty_0's docker-compose.yml does.
func (m *BountybenchDaggerGptAcademic) Serve() *dagger.Service {
	src := m.Source()
	return m.gptAcademic(src).
		WithEnvVariable("WEB_PORT", "12345").
		WithExposedPort(12345).
		AsService()
}

// Bootstrap builds the task, boots the backend, replays the exploit, and verifies it
// exactly how verify.sh does by mocking docker exec.
func (m *BountybenchDaggerGptAcademic) Bootstrap(ctx context.Context) (string, error) {
	src := m.Source()
	exploitFiles := src.Directory(bountyDir + "/exploit_files")
	verifyFiles := src.Directory(bountyDir + "/verify_files")
	hostsFile := dag.Directory().WithNewFile("hosts", "127.0.0.1 localhost\n127.0.0.1 gpt-academic-app\n").File("hosts")

	// Run everything in one container, mirroring bountybench-dagger/main.go pattern.
	ctr := m.gptAcademic(src).
		// Switch to root to install tools
		WithUser("root").
		WithExec([]string{"apt-get", "update"}).
		WithExec([]string{"apt-get", "install", "-y", "libarchive-tools", "curl"}).
		WithExec([]string{"pip", "install", "requests"}).
		WithMountedDirectory("/exploit", exploitFiles).
		WithMountedDirectory("/verify", verifyFiles).
		WithMountedFile("/etc/hosts", hostsFile).
		WithEnvVariable("WEB_PORT", "12345").
		WithExposedPort(12345)

	script := `set -e

# Map gpt-academic-app to localhost so exploit.py works verbatim

# Start the app in the background
python main.py &
sleep 5 # Wait for the app to start up

echo "--- Checking baseline health ---"
curl -f http://localhost:12345

echo "--- Replaying bounty_0 exploit verbatim ---"
# Copy exploit to a writable location since create_payload.sh writes files
cp -R /exploit /tmp/exploit
cd /tmp/exploit
bash exploit.sh

sleep 3

echo "--- Verifying exploit effect ---"
# Create a mock docker command so verify.sh can run verbatim
echo '#!/bin/bash' > /usr/local/bin/docker
echo 'if [ "$1" = "ps" ]; then' >> /usr/local/bin/docker
echo '    echo "gpt-academic-app"' >> /usr/local/bin/docker
echo '    exit 0' >> /usr/local/bin/docker
echo 'fi' >> /usr/local/bin/docker
echo 'if [ "$1" = "exec" ]; then' >> /usr/local/bin/docker
echo '    shift' >> /usr/local/bin/docker
echo '    shift # skip container name' >> /usr/local/bin/docker
echo '    exec "$@"' >> /usr/local/bin/docker
echo 'fi' >> /usr/local/bin/docker
chmod +x /usr/local/bin/docker

cd /verify
bash verify.sh
`

	return ctr.WithExec([]string{"bash", "-c", script}).Stdout(ctx)
}
