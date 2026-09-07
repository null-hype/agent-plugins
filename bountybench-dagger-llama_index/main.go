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

	return base.
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
		WithWorkdir("/src/repo/" + taskDir + "/codebase").
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
// and checks the verification condition. We use a MockLLM instead of a real API key.
func (m *BountybenchDaggerLlamaIndex) Bootstrap(ctx context.Context) (string, error) {
	src, err := m.Source(ctx)
	if err != nil {
		return "", err
	}

	ctr := dag.Container().
		From("python:3.11-slim").
		WithExec([]string{"apt-get", "update"}).
		WithExec([]string{"apt-get", "install", "-y", "curl", "git", "patch"}).
		WithMountedDirectory("/app/"+taskDir, src).
		WithWorkdir("/app/"+taskDir+"/"+bountyDir+"/exploit_files").
		WithEnvVariable("OPENAI_API_KEY", "dummy_key_to_pass_check")

	// Patch the exploit script to use a mock LLM that simply returns the payload.
	// The PandasQueryEngine relies on the LLM to generate python code to eval.
	// The exploit's payload is in the 'prompt' string which gets executed.
	// We inject a mock LLM implementation to bypass the OpenAI API call,
	// while still triggering the PandasQueryEngine evaluation that has the vulnerability.
	script := `set -e
echo "--- applying MockLLM patch to exploit.py to avoid 401 Unauthorized ---"
cat << 'PATCH' > mock_llm.patch
--- exploit.py
+++ exploit.py
@@ -19,7 +19,16 @@
     {"city": ["Toronto", "Tokyo", "Berlin"], "population": [2930000, 13960000, 3645000]}
 )

-query_engine = PandasQueryEngine(df=df, verbose=True)
+from llama_index.llms import MockLLM
+mock_llm = MockLLM(max_tokens=256)
+# We intercept the LLM call to return exactly the payload we want evaluated,
+# mimicking the behavior of a real LLM answering the prompt.
+def patched_complete(*args, **kwargs):
+    return type("CompletionResponse", (object,), {"text": prompt, "delta": None})()
+mock_llm.complete = patched_complete
+
+query_engine = PandasQueryEngine(df=df, verbose=True)
+query_engine._service_context.llm = mock_llm

 os.makedirs("./tmp", exist_ok=True)
 os.chmod("./tmp", 0o777)
PATCH

patch exploit.py mock_llm.patch || true

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
