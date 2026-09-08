package main

import (
	"context"

	"dagger/bountybench-dagger-gradio/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "gradio"
	bountyDir       = "bounties/bounty_0"
)

type BountybenchDaggerGradio struct{}

// Source clones bountybench/bountytasks and initializes the gradio task's
// codebase submodule, checking out the exact vulnerable commit read from metadata.
func (m *BountybenchDaggerGradio) Source() *dagger.Directory {
	return dag.Container().
		From("alpine/git:latest").
		WithExec([]string{"apk", "add", "jq"}).
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
		WithWorkdir("/src/repo/" + taskDir + "/codebase").
		WithExec([]string{"sh", "-c", "VULN_COMMIT=$(jq -r .vulnerable_commit /src/repo/" + taskDir + "/" + bountyDir + "/bounty_metadata.json) && git fetch --depth 1 origin $VULN_COMMIT && git checkout $VULN_COMMIT"}).
		Directory("/src/repo/" + taskDir)
}

// app builds the gradio application according to its Dockerfile.
//
// gradio's own setup imports `HfFolder` from huggingface_hub (via
// gradio/oauth.py) at import time, and that symbol was removed from modern
// huggingface_hub releases -- a corpus-drift bug, not a mistake in the
// Dockerfile. Pin huggingface_hub to a version from this codebase's vintage
// (still ships HfFolder) before the codebase's own pip install runs.
func (m *BountybenchDaggerGradio) app(src *dagger.Directory) *dagger.Container {
	patched := dag.Container().
		From("alpine:3.19").
		WithMountedDirectory("/src", src).
		WithWorkdir("/src").
		WithExec([]string{"sed", "-i",
			`s|RUN pip install -e /codebase|RUN pip install "huggingface_hub<0.24"\nRUN pip install -e /codebase|`,
			"Dockerfile"}).
		Directory("/src")
	return patched.DockerBuild(dagger.DirectoryDockerBuildOpts{
		Dockerfile: "Dockerfile",
	})
}

// Serve returns the built gradio app as a running Service on port 7860.
func (m *BountybenchDaggerGradio) Serve() *dagger.Service {
	src := m.Source()
	return m.app(src).
		WithExposedPort(7860).
		AsService()
}

// Bootstrap builds the gradio bounty_0 task, boots the gradio app,
// and replays the task's actual exploit and verify scripts verbatim.
func (m *BountybenchDaggerGradio) Bootstrap(ctx context.Context) (string, error) {
	appSvc := m.Serve()
	src := m.Source()

	exploitFiles := src.Directory(bountyDir + "/exploit_files")
	verifyFiles := src.Directory(bountyDir + "/verify_files")

	ctr := dag.Container().
		From("ubuntu:22.04").
		WithExec([]string{"apt-get", "update"}).
		WithExec([]string{"apt-get", "install", "-y", "curl"}).
		WithServiceBinding("gradio", appSvc).
		WithMountedDirectory("/exploit_files", exploitFiles).
		WithMountedDirectory("/verify_files", verifyFiles).
		WithWorkdir("/exploit_files")

	script := `#!/bin/bash
set -e

# Wait for gradio app to be responsive
echo "--- waiting for gradio app to start ---"
WAIT_TIME=0
while [ $WAIT_TIME -lt 60 ]; do
  if curl -s http://gradio:7860/ -o /dev/null -w "%{http_code}" | grep -qE "200|404"; then
    echo "Gradio is ready"
    break
  fi
  sleep 1
  WAIT_TIME=$((WAIT_TIME + 1))
done

if [ $WAIT_TIME -eq 60 ]; then
  echo "Gradio failed to start or respond in time"
  exit 1
fi

echo "--- replaying bounty_0 exploit.sh verbatim ---"
cd /exploit_files
chmod +x exploit.sh
./exploit.sh

echo "--- replaying bounty_0 verify.sh verbatim ---"
cd /verify_files
chmod +x verify.sh
./verify.sh
`

	return ctr.WithExec([]string{"bash", "-c", script}).Stdout(ctx)
}
