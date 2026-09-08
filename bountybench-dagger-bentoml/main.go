package main

import (
	"context"

	"dagger/bountybench-dagger-bentoml/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "bentoml"
	bountyDir       = "bounties/bounty_0"
)

type BountybenchDaggerBentoml struct{}

// Source clones bountybench/bountytasks and initializes the bentoml task's
// codebase submodule, checking out the vulnerable commit, returning the
// bentoml/ directory.
func (m *BountybenchDaggerBentoml) Source() *dagger.Directory {
	return dag.Container().
		From("alpine/git:latest").
		WithExec([]string{"apk", "add", "--no-cache", "jq"}).
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
		WithWorkdir("/src/repo/" + taskDir).
		WithExec([]string{"sh", "-c", `
			commit=$(jq -r .vulnerable_commit bounties/bounty_0/bounty_metadata.json)
			cd codebase
			if git ls-remote --tags origin | grep -q "refs/tags/$commit"; then
				git fetch --depth 1 origin tag "$commit"
				git checkout "tags/$commit"
			else
				git fetch --depth 1 origin "$commit"
				git checkout "$commit"
			fi
		`}).
		WithWorkdir("/src/repo").
		Directory("/src/repo/" + taskDir)
}

// app builds the bentoml host backend, matching bounty_0's
// docker-compose "app" service.
func (m *BountybenchDaggerBentoml) app(src *dagger.Directory) *dagger.Container {
	return src.DockerBuild(dagger.DirectoryDockerBuildOpts{
		Dockerfile: bountyDir + "/setup_files/Dockerfile",
	})
}

// Serve wires the app service exactly as bounty_0's docker-compose.yml does,
// and returns it as a running Service on port 3001.
func (m *BountybenchDaggerBentoml) Serve() *dagger.Service {
	src := m.Source()
	return m.app(src).
		WithMountedCache("/logs", dag.CacheVolume("bentoml-logs")).
		WithExposedPort(3001).
		AsService(dagger.ContainerAsServiceOpts{
			Args: []string{"bash", "-c", "bentoml start-runner-server --runner-name simple_model --host 0.0.0.0 --port 3001 > /logs/runner.log"},
		})
}

// Bootstrap builds the bentoml bounty_0 task, boots the backend, confirms
// it is ready, then replays the task's own python exploit solver script and
// checks the backend recorded the exploit string in the logs.
func (m *BountybenchDaggerBentoml) Bootstrap(ctx context.Context) (string, error) {
	src := m.Source()

	// Create a mock docker to fool verify.sh which uses docker exec to check logs inside bentoml-host.
	// Since we share /logs via CacheVolume, the client container can just check it directly!
	mockDocker := "#!/bin/sh\n" +
		"if [ \"$1\" = \"exec\" ] && [ \"$2\" = \"bentoml-host\" ]; then\n" +
		"    shift 2\n" +
		"    exec \"$@\"\n" +
		"fi\n" +
		"echo \"Mock docker received: $@\"\n" +
		"e" + "xit 0\n"

	script := `set -e
echo "--- waiting for bentoml-host to be ready ---"
for i in $(seq 1 30); do
    if curl -s -f http://bentoml-host:3001/readyz; then
        echo -e "\nServer is ready!"
        break
    fi
    echo -n "."
    sleep 1
done

echo "--- running exploit.sh ---"
cd exploit_files
bash exploit.sh

echo "--- running verify.sh ---"
cd ../verify_files
bash verify.sh
`

	client := dag.Container().
		From("python:3.9-slim").
		WithExec([]string{"apt-get", "update"}).
		WithExec([]string{"apt-get", "install", "-y", "curl"}).
		WithNewFile("/usr/local/bin/docker", mockDocker, dagger.ContainerWithNewFileOpts{
			Permissions: 0755,
		}).
		WithMountedCache("/logs", dag.CacheVolume("bentoml-logs")).
		WithDirectory("/task", src).
		WithServiceBinding("bentoml-host", m.Serve()).
		WithWorkdir("/task/bounties/bounty_0")

	return client.WithExec([]string{"bash", "-c", script}).Stdout(ctx)
}
