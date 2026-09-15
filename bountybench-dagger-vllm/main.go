// A Dagger module that bootstraps a single application from the
// bountybench/bountytasks corpus (https://github.com/bountybench/bountytasks).
//
// It targets vllm/bounties/bounty_0: a remote code execution vulnerability
// in vLLM's MessageQueue when handling untrusted data via pickle.loads.
// Bootstrap runs the python app in a single container, replays the task's own
// exploit_files/exploit.sh verbatim, and checks the verification condition using verify.sh.
package main

import (
	"context"

	dag "dagger/bountybench-dagger-vllm/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "vllm"
	bountyDir       = "bounties/bounty_0"
)

type BountybenchDaggerVllm struct{}

// Source clones bountybench/bountytasks and initializes the vllm task's
// codebase submodule (the public vllm fork), returning the
// vllm/ directory -- the build context the task's own Dockerfiles expect.
// It also checks out the exact vulnerable_commit specified in bounty_metadata.json (v0.6.2).
func (m *BountybenchDaggerVllm) Source() *dag.Directory {
	return dag.Container().
		From("alpine/git:latest").
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		// Initialize the submodule from the repo root
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
		WithWorkdir("/src/repo/" + taskDir + "/codebase").
		// Fetch and checkout the exact vulnerable commit v0.6.2
		WithExec([]string{"git", "fetch", "origin", "tag", "v0.6.2"}).
		WithExec([]string{"git", "checkout", "v0.6.2"}).
		WithWorkdir("/src/repo").
		Directory("/src/repo/" + taskDir)
}

// vllmApp builds a container with the base dependencies required to run the exploit script.
// Note: This bounty lacks a Dockerfile, so we use a base image with python3.9 and apt-get.
func (m *BountybenchDaggerVllm) vllmApp(src *dag.Directory) *dag.Container {
	return dag.Container().
		From("python:3.9-slim").
		WithExec([]string{"apt-get", "update"}).
		WithExec([]string{"apt-get", "install", "-y", "git", "build-essential", "cmake", "netcat-openbsd", "bash"}).
		// The exploit script uses ../../../codebase, so we mount the entire src directory at /app
		WithDirectory("/app", src).
		WithWorkdir("/app/" + bountyDir + "/exploit_files")
}

// Serve returns the vllm container as a running Service.
func (m *BountybenchDaggerVllm) Serve() *dag.Service {
	src := m.Source()
	return m.vllmApp(src).
		WithExec([]string{"sleep", "infinity"}).
		AsService()
}

// Bootstrap builds the vllm bounty_0 task, sets up the environment by executing
// exploit.sh verbatim, which sends specially crafted payloads to trigger RCE via pickle.loads,
// and checks that the verification file is created using verify.sh.
func (m *BountybenchDaggerVllm) Bootstrap(ctx context.Context) (string, error) {
	src := m.Source()
	ctr := m.vllmApp(src)

	// We run both scripts sequentially in one bash shell to preserve stdout/stderr
	// for the final transcript.
	return ctr.
		WithExec([]string{"bash", "-c", "bash exploit.sh && cd ../verify_files && bash verify.sh"}).
		Stdout(ctx)
}
