package main

import (
	"context"

	dag "dagger/bountybench-dagger-pytorch-lightning/internal/dagger"
)

const (
	bountytasksRepo  = "https://github.com/bountybench/bountytasks.git"
	taskDir          = "pytorch-lightning"
	bountyDir        = "bounties/bounty_0"
	vulnerableCommit = "2.2.1"
)

type BountybenchDaggerPytorchLightning struct{}

// Source clones bountybench/bountytasks and initializes the pytorch-lightning task's
// codebase submodule (the public Lightning-AI/pytorch-lightning repository), returning the
// pytorch-lightning/ directory -- the build context the task's own Dockerfiles expect.
func (m *BountybenchDaggerPytorchLightning) Source() *dag.Directory {
	return dag.Container().
		From("alpine/git:latest").
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
		Directory("/src/repo/" + taskDir)
}

// appService builds the pytorch-lightning backend, matching bounty_0's
// docker-compose "app" service.
func (m *BountybenchDaggerPytorchLightning) appService(src *dag.Directory) *dag.Container {
	return src.DockerBuild(dag.DirectoryDockerBuildOpts{
		Dockerfile: "Dockerfile",
	})
}

// Serve wires the service exactly as bounty_0's docker-compose.yml does.
func (m *BountybenchDaggerPytorchLightning) Serve() *dag.Service {
	src := m.Source()
	appContainer := m.appService(src).WithExposedPort(7501)
	return appContainer.AsService()
}

// Bootstrap builds the pytorch-lightning bounty_0 task, boots the service,
// replays the exploit, and verifies the outcome.
func (m *BountybenchDaggerPytorchLightning) Bootstrap(ctx context.Context) (string, error) {
	src := m.Source()
	exploitFiles := src.Directory(bountyDir + "/exploit_files")

	// We share a volume between the app and the client container to capture logs.
	logVol := dag.CacheVolume("pytorch-lightning-logs")

	// Create app container and redirect output to log file, intercepting the command
	// We want to avoid losing network settings from the Dockerfile, but there are none,
	// just ENV LIGHTNING_APP_STATE_URL=http://0.0.0.0 and CMD ["python3", "-m", "lightning", "run", "app", "app.py"]
	// Use WithEntrypoint to allow the command to run as a service instead of blocking.
	appContainer := m.appService(src).
		WithMountedCache("/logs", logVol).
		WithEntrypoint([]string{"sh", "-c", "python3 -m lightning run app app.py > /logs/app.log 2>&1"})

	appService := appContainer.WithExposedPort(7501).AsService()

	verifyFiles := src.Directory(bountyDir + "/verify_files")

	mockDocker := `#!/bin/sh
if [ "$1" = "logs" ]; then
    cat /logs/app.log
elif [ "$1" = "inspect" ]; then
    if curl -sS http://lightning-app:7501/dashboard | grep -q '<!doctype html>'; then
        echo "healthy"
    else
        echo "unhealthy"
    fi
else
    echo "Mock docker: unknown command $@"
    exit 1
fi
`

	// Client container to run healthcheck, exploit, and verify
	ctr := dag.Container().
		From("python:3.11-slim").
		WithExec([]string{"apt-get", "update"}).
		WithExec([]string{"apt-get", "install", "-y", "curl", "docker.io"}).
		WithNewFile("/usr/local/bin/docker", dag.ContainerWithNewFileOpts{Contents: mockDocker, Permissions: 0755}).
		WithMountedDirectory("/exploit", exploitFiles).
		WithMountedDirectory("/verify", verifyFiles).
		WithMountedCache("/logs", logVol).
		WithServiceBinding("lightning-app", appService).
		WithWorkdir("/exploit")

	script := `set -e

echo "--- baseline: waiting for app to be healthy ---"
# Poll until healthy, do not rely on verify.sh's blind check as baseline
startup_timeout=60
start=$(date +%s)
while true; do
    if docker inspect lightning-app | grep -q 'healthy'; then
        echo "Container is healthy."
        break
    fi
    if [ $(($(date +%s) - start)) -ge $startup_timeout ]; then
        echo "Timeout waiting for healthy."
        exit 1
    fi
    sleep 2
done

echo "--- baseline: ensuring exploit output is not already present ---"
if docker logs lightning-app | tail -n 1 | grep -q "Hello from exploit!"; then
    echo "Error: Baseline check failed, exploit output already present"
    exit 1
fi

echo "--- replaying bounty_0 exploit ---"
bash /exploit/exploit.sh

sleep 5
echo "--- verifying backend recorded the expected log via verify.sh ---"
bash /verify/verify.sh
`
	return ctr.WithExec([]string{"sh", "-c", script}).Stdout(ctx)
}
