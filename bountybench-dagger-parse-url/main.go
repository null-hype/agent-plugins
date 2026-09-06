// A Dagger module that bootstraps a single application from the
// bountybench/bountytasks corpus (https://github.com/bountybench/bountytasks).
//
// It targets parse-url/bounties/bounty_0: a Node.js library vulnerable to SSRF
// (Server-Side Request Forgery) via incorrect URL parsing that treats certain
// malformed URLs as having SSH schemes with unexpected user/resource parsing
// (CVE-2022-2900, CWE-918). Bootstrap runs the vulnerable code, executes
// the task's own POC, and verifies the SSRF possibility is detected.
package main

import (
	"context"

	"dagger/bountybench-dagger-parse-url/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "parse-url"
	bountyDir       = "bounties/bounty_0"
	// bounty_metadata.json's "vulnerable_commit": "8.0.0" -- the submodule
	// pointer bountytasks currently carries resolves to v9.2.0, which
	// already has the SSRF fix (patch_files/index.js -> codebase/src/index.js).
	// Confirmed live: without this checkout, parseUrl() on the exploit's
	// malformed URL throws "URL parsing failed" instead of the vulnerable
	// mis-parse the exploit expects.
	vulnerableCommit = "8.0.0"
)

type BountybenchDaggerParseUrl struct{}

// Source clones bountybench/bountytasks and initializes the parse-url task's
// codebase submodule, then checks the submodule out to bounty_metadata.json's
// pinned vulnerable_commit (the submodule pointer itself tracks a newer,
// already-patched revision). Returns the parse-url/ directory.
func (m *BountybenchDaggerParseUrl) Source() *dagger.Directory {
	return dag.Container().
		From("alpine/git:latest").
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
		WithWorkdir("/src/repo/" + taskDir + "/codebase").
		WithExec([]string{"git", "fetch", "--depth", "1", "origin", "tag", vulnerableCommit}).
		WithExec([]string{"git", "checkout", "tags/" + vulnerableCommit}).
		WithWorkdir("/src/repo/" + taskDir).
		Directory("/src/repo/" + taskDir)
}

// Bootstrap clones bountybench/bountytasks, installs the vulnerable parse-url
// library via npm, runs the POC script to demonstrate the SSRF vulnerability,
// and verifies the output matches expected values indicating the vulnerability exists.
func (m *BountybenchDaggerParseUrl) Bootstrap(ctx context.Context) (string, error) {
	src := m.Source()

	script := `set -e

echo "--- Setting up Node.js environment ---"
apt-get update
apt-get install -y python3

echo "--- Node.js already provided by the node:18-slim base image ---"
node --version
npm --version

echo "--- Installing npm dependencies for vulnerable parse-url ---"
npm install --prefix /src/codebase

# codebase's own package.json only declares module type for the built
# dist/ output (exports.import -> dist/index.mjs); poc.js imports the raw
# src/index.js directly, which has no package.json of its own, so Node
# treats it as CommonJS by default and rejects its "import" syntax. Node
# resolves module type from the nearest package.json to the imported
# file, so scoping one to src/ (rather than editing any source file)
# fixes this for src/index.js and everything it imports internally.
echo '{"type":"module"}' > /src/codebase/src/package.json

echo "--- Running POC to test SSRF vulnerability ---"
cd /src/bounties/bounty_0/exploit_files
# poc.js uses ES module import syntax but has no package.json declaring
# "type": "module" -- Node treats bare .js as CommonJS by default and
# refuses the import. Copy to .mjs (always ESM, same directory so the
# relative "../../../codebase/src/index.js" import still resolves
# correctly) rather than editing the bounty's own poc.js.
cp poc.js poc.mjs
node poc.mjs > ./output.json
echo "POC output:"
cat ./output.json

echo "--- Verifying vulnerability detection ---"
cd /src/bounties/bounty_0/verify_files
python3 verify.py || {
	echo "Verification script failed or returned unexpected output"
	exit 1
}

echo "SSRF vulnerability confirmed!"
`

	return dag.Container().
		From("node:18-slim").
		WithMountedDirectory("/src", src).
		WithExec([]string{"sh", "-c", script}).
		Stdout(ctx)
}
