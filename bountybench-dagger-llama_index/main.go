package main

import (
	"context"
	"fmt"
	"strings"

	"dagger/bountybench-dagger-llama-index/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "llama_index"
	bountyDir       = "bounties/bounty_0"
)

type BountybenchDaggerLlamaIndex struct{}

// Source clones bountybench/bountytasks and initializes the llama_index task's
// codebase submodule, returning the llama_index/ directory. It dynamically
// reads the vulnerable_commit from bounty_metadata.json and checks it out.
func (m *BountybenchDaggerLlamaIndex) Source(ctx context.Context) (*dagger.Directory, error) {
	base := dag.Container().
		From("alpine/git:latest").
		WithExec([]string{"apk", "add", "--no-cache", "jq"}).
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"})

	repoDir := base.Directory("/src/repo")
	metadataFile := repoDir.File(taskDir + "/" + bountyDir + "/bounty_metadata.json")
	commitStr, err := base.
		WithMountedFile("/tmp/bounty_metadata.json", metadataFile).
		WithExec([]string{"jq", "-r", ".vulnerable_commit", "/tmp/bounty_metadata.json"}).
		Stdout(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to read vulnerable_commit: %w", err)
	}
	commit := strings.TrimSpace(commitStr)

	// Determine if commit is a tag or a SHA. Usually if it starts with "v" it's a tag.
	// But git fetch origin <sha> and git checkout <sha> works generally.
	// We will try fetching it as a commit/tag directly.
	return base.
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
		WithWorkdir("/src/repo/" + taskDir + "/codebase").
		// Try fetching as tag first, if it fails fetch as commit. We can do this via shell script.
		WithExec([]string{"sh", "-c", fmt.Sprintf(`
			git fetch --depth 1 origin tag %s 2>/dev/null && git checkout tags/%s || \
			(git fetch --depth 1 origin %s && git checkout %s)
		`, commit, commit, commit, commit)}).
		Directory("/src/repo/" + taskDir), nil
}

// Serve is a placeholder since this task has no long-running services.
func (m *BountybenchDaggerLlamaIndex) Serve(ctx context.Context) (*dagger.Service, error) {
	return dag.Container().
		From("alpine:latest").
		WithExec([]string{"sleep", "infinity"}).
		AsService(), nil
}

// Bootstrap builds the llama_index bounty_0 task, runs the exploit script,
// and checks the verification condition verbatim.
func (m *BountybenchDaggerLlamaIndex) Bootstrap(ctx context.Context) (string, error) {
	src, err := m.Source(ctx)
	if err != nil {
		return "", err
	}

	// This bounty has no docker-compose or Dockerfile. It installs via requirements.sh or pip install -e .
	// exploit.sh changes to codebase and installs it, then runs python exploit.py in exploit_files.
	// We setup a basic Python container to run these scripts verbatim.
	ctr := dag.Container().
		From("python:3.11-slim").
		WithExec([]string{"apt-get", "update"}).
		WithExec([]string{"apt-get", "install", "-y", "curl", "git"}).
		WithMountedDirectory("/app/"+taskDir, src).
		WithWorkdir("/app/"+taskDir+"/"+bountyDir+"/exploit_files").
		WithEnvVariable("OPENAI_API_KEY", "dummy_key_to_pass_check")

	// We can replay exploit.sh verbatim
	script := `set -e
echo "--- replaying bounty_0 exploit.sh ---"
chmod +x exploit.sh
./exploit.sh 2>&1 || true

echo "--- verifying exploit success ---"
cd ../verify_files
chmod +x verify.sh
./verify.sh
`

	return ctr.WithExec([]string{"sh", "-c", script}).Stdout(ctx)
}
