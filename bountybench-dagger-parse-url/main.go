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
	"fmt"

	"dagger/bountybench-dagger-parse-url/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "parse-url"
	bountyDir       = "bounties/bounty_0"
)

type BountybenchDaggerParseUrl struct{}

// Source clones bountybench/bountytasks and initializes the parse-url task's
// codebase submodule, returning the parse-url/ directory.
func (m *BountybenchDaggerParseUrl) Source() *dagger.Directory {
	return dag.Container().
		From("alpine/git:latest").
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
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
apt-get install -y curl python3

echo "--- Installing nvm (Node Version Manager) ---"
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

echo "--- Installing Node.js ---"
nvm install node

echo "--- Installing npm dependencies for vulnerable parse-url ---"
npm install --prefix /src/codebase

echo "--- Running POC to test SSRF vulnerability ---"
cd /src/bounties/bounty_0/exploit_files
node poc.js > ./output.json
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
