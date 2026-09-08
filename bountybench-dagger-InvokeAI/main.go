package main

import (
	"context"
	"fmt"

	dag "dagger/bountybench-dagger-InvokeAI/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "InvokeAI"
	bountyDir       = "bounties/bounty_0"
)

type BountybenchDaggerInvokeAi struct{}

// Source clones bountybench/bountytasks and initializes the InvokeAI task's
// codebase submodule, returning the InvokeAI/ directory.
// It also extracts the vulnerable_commit from bounty_metadata.json and checks it out.
func (m *BountybenchDaggerInvokeAi) Source() *dag.Directory {
	return dag.Container().
		From("alpine/git:latest").
		WithExec([]string{"apk", "add", "--no-cache", "jq"}).
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
		WithWorkdir("/src/repo/" + taskDir).
		WithExec([]string{"sh", "-c", `
			COMMIT=$(jq -r .vulnerable_commit bounties/bounty_0/bounty_metadata.json)
			cd codebase
			if echo "$COMMIT" | grep -q "^v"; then
				git fetch --depth 1 origin tag "$COMMIT"
				git checkout "tags/$COMMIT"
			else
				git fetch --depth 1 origin "$COMMIT"
				git checkout "$COMMIT"
			fi
		`}).
		Directory("/src/repo/" + taskDir)
}

// app builds the invokeai service, matching docker-compose.yml
func (m *BountybenchDaggerInvokeAi) app(src *dag.Directory) *dag.Container {
	return src.DockerBuild(dag.DirectoryDockerBuildOpts{
		Dockerfile: "Dockerfile",
	})
}

// Serve wires the app service as described in docker-compose.yml.
func (m *BountybenchDaggerInvokeAi) Serve() *dag.Service {
	src := m.Source()

	return m.app(src).
		WithEnvVariable("INVOKEAI_HOST", "0.0.0.0").
		WithExposedPort(9090).
		AsService()
}

// Bootstrap builds the InvokeAI task, runs it, then executes
// the setup, exploit and verify scripts to reproduce bounty_0.
func (m *BountybenchDaggerInvokeAi) Bootstrap(ctx context.Context) (string, error) {
	src := m.Source()
	setupFiles := src.Directory(bountyDir + "/setup_files")
	exploitFiles := src.Directory(bountyDir + "/exploit_files")
	verifyFiles := src.Directory(bountyDir + "/verify_files")

	// The verification script does `docker exec invokeai sh -c '[ -e /tmp/hacked ]'`,
	// meaning it looks for the /tmp/hacked file on the service container.
	// Since we can't easily docker exec into the service, we can mount a shared volume.
	cacheVol := dag.CacheVolume("invokeai-tmp")

	appSvc := m.app(src).
		WithEnvVariable("INVOKEAI_HOST", "0.0.0.0").
		WithMountedCache("/tmp", cacheVol).
		WithExposedPort(9090).
		AsService()

	// Client container to run the scripts
	ctr := dag.Container().
		From("alpine:3.19").
		WithExec([]string{"apk", "add", "--no-cache", "bash", "curl", "docker-cli"}).
		WithMountedDirectory("/setup_files", setupFiles).
		WithMountedDirectory("/exploit_files", exploitFiles).
		WithMountedDirectory("/verify_files", verifyFiles).
		WithMountedCache("/invokeai_tmp", cacheVol).
		WithServiceBinding("invokeai", appSvc)

	// Since setup_bounty_env.sh and verify.sh use `docker exec invokeai ...`, we need to mock docker.
	// `docker exec invokeai touch /tmp/hacked` -> we can run it against the cache mount.
	mockDocker := `#!/bin/bash
if [ "$1" = "exec" ] && [ "$2" = "invokeai" ]; then
	shift 2
	new_args=()
	for arg in "$@"; do
		new_args+=("${arg//\/tmp//invokeai_tmp}")
	done
	"${new_args[@]}"
else
	/usr/bin/docker "$@"
fi
`

	script := fmt.Sprintf(`set -e
echo "--- wait for app to start ---"
for i in $(seq 1 30); do
	if curl -s http://invokeai:9090 > /dev/null; then
		echo "app is up!"
		break
	fi
	sleep 2
done

echo "--- setup ---"
cd /setup_files
bash setup_bounty_env.sh

echo "--- exploit ---"
cd /exploit_files
bash exploit.sh

sleep 2

echo "--- verify ---"
cd /verify_files
bash verify.sh
`)

	return ctr.
		WithNewFile("/usr/local/bin/docker", dag.ContainerWithNewFileOpts{
			Contents:    mockDocker,
			Permissions: 0755,
		}).
		WithExec([]string{"bash", "-c", script}).Stdout(ctx)
}
