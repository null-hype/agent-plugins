package main

import (
	"context"

	"dagger/bountybench-dagger-composio/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "composio"
	bountyDir       = "bounties/bounty_0"
)

type BountybenchDaggerComposio struct{}

// Source clones bountybench/bountytasks and initializes the composio task's
// codebase submodule, returning the composio/ directory.
func (m *BountybenchDaggerComposio) Source() *dagger.Directory {
	return dag.Container().
		From("alpine/git:latest").
		WithExec([]string{"apk", "add", "--no-cache", "jq"}).
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		WithExec([]string{"sh", "-c", "git submodule update --init --depth 1 " + taskDir + "/codebase"}).
		WithWorkdir("/src/repo/" + taskDir).
		WithExec([]string{"sh", "-c", "COMMIT=$(jq -r .vulnerable_commit " + bountyDir + "/bounty_metadata.json) && cd codebase && git fetch --depth 1 origin tag $COMMIT && git checkout tags/$COMMIT"}).
		WithWorkdir("/src/repo").
		Directory("/src/repo/" + taskDir)
}

// app builds the composio-server, matching bounty_0's docker-compose "app" service.
func (m *BountybenchDaggerComposio) app(src *dagger.Directory) *dagger.Container {
	return src.DockerBuild(dagger.DirectoryDockerBuildOpts{
		Dockerfile: "Dockerfile",
	})
}

// Serve wires the app service exactly as bounty_0's docker-compose.yml does.
func (m *BountybenchDaggerComposio) Serve() *dagger.Service {
	src := m.Source()

	return m.app(src).
		WithEnvVariable("ACCESS_TOKEN", "aaa").
		WithEnvVariable("COMPOSIO_HOST", "0.0.0.0").
		WithExposedPort(8000).
		AsService(dagger.ContainerAsServiceOpts{
			Args: []string{"composio", "serve", "--host", "0.0.0.0"},
		})
}

// Bootstrap builds the composio bounty_0 task, boots the backend, replays the
// task's own exploit, and checks its own verification file in one pipeline.
func (m *BountybenchDaggerComposio) Bootstrap(ctx context.Context) (string, error) {
	src := m.Source()

	// Create client container to run the exploit and verification.
	// It relies on the app service running as "composio-server" to match the exploit.sh.
	client := dag.Container().
		From("alpine/curl:latest").
		WithUser("root").
		WithExec([]string{"apk", "add", "--no-cache", "bash", "grep"}).
		WithDirectory("/bounty", src.Directory(bountyDir)).
		WithWorkdir("/bounty/exploit_files").
		WithServiceBinding("composio-server", m.Serve()).
		WithExec([]string{"bash", "-c", "bash exploit.sh && cd ../verify_files && bash verify.sh"})

	return client.Stdout(ctx)
}
