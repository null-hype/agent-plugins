// A Dagger module that bootstraps a single application from the
// bountybench/bountytasks corpus (https://github.com/bountybench/bountytasks).
//
// It targets yaml/bounties/bounty_0: a library vulnerability.
// Bootstrap reproduces the exploit environment, runs the exploit script,
// and verifies the expected RangeError.
package main

import (
	"context"
	"fmt"

	"dagger/bountybench-dagger-yaml/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "yaml"
	bountyDir       = "bounties/bounty_0"
)

type BountybenchDaggerYaml struct{}

// Source clones bountybench/bountytasks and initializes the yaml task's
// codebase submodule (the public eemeli/yaml fork), returning the
// yaml/ directory.
func (m *BountybenchDaggerYaml) Source() *dagger.Directory {
	// We extract the vulnerable commit dynamically from the metadata and perform
	// a specific fetch and checkout inside the full repository context. This preserves
	// necessary git metadata instead of fetching inside a detached subtree copy.
	return dag.Container().
		From("alpine/git:latest").
		WithExec([]string{"apk", "add", "--no-cache", "jq"}).
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
		WithExec([]string{"sh", "-c", fmt.Sprintf(`
			VULN_COMMIT=$(jq -r '.vulnerable_commit' %s/%s/bounty_metadata.json)
			cd %s/codebase
			git fetch origin $VULN_COMMIT --depth 1
			git checkout FETCH_HEAD
		`, taskDir, bountyDir, taskDir)}).
		Directory("/src/repo/" + taskDir)
}

// yamlApp represents the core environment. Since this target has no docker-compose.yml
// or Dockerfile, this helper creates the equivalent execution environment container directly.
func (m *BountybenchDaggerYaml) yamlApp(src *dagger.Directory) *dagger.Container {
	return dag.Container().
		From("ubuntu:22.04").
		WithExec([]string{"apt-get", "update"}).
		// Added git, as npm might need it to pull source dependencies
		WithExec([]string{"apt-get", "install", "-y", "curl", "bash", "git"}).
		WithMountedDirectory("/yaml/codebase", src.Directory("codebase")).
		WithMountedDirectory(fmt.Sprintf("/yaml/%s/setup_files", bountyDir), src.Directory(bountyDir+"/setup_files")).
		WithMountedDirectory(fmt.Sprintf("/yaml/%s/exploit_files", bountyDir), src.Directory(bountyDir+"/exploit_files")).
		WithMountedDirectory(fmt.Sprintf("/yaml/%s/verify_files", bountyDir), src.Directory(bountyDir+"/verify_files"))
}

// Serve represents the running services. Since the yaml task lacks a background service
// and a docker-compose.yml, this returns a sleep container to fulfill the shape.
func (m *BountybenchDaggerYaml) Serve() *dagger.Service {
	src := m.Source()
	return m.yamlApp(src).
		WithExec([]string{"sleep", "infinity"}).
		AsService()
}

// Bootstrap builds the yaml bounty_0 task, runs the setup, records a baseline,
// runs the exploit script, and verifies the RangeError was triggered,
// mirroring bounty_0's verify.sh.
func (m *BountybenchDaggerYaml) Bootstrap(ctx context.Context) (string, error) {
	src := m.Source()
	ctr := m.yamlApp(src).WithWorkdir(fmt.Sprintf("/yaml/%s", bountyDir))

	script := `set -eo pipefail

# Run setup
cd setup_files
bash setup_bounty_env.sh
cd ..

echo "--- baseline: preparing baseline ---"
# Install nvm and node just like the exploit script does so we can test it
# Note: NVM script sourcing can fail if set -u is used, so we use +u around it.
set +u
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
set -u

nvm install node
npm install --prefix ../../codebase
npm --prefix ../../codebase run build

echo "--- baseline: capturing baseline assertion ---"
# Check that normal YAML still parses (shows library functions properly)
cat << 'EOF' > baseline.js
const yaml = require("../../codebase");
yaml.parseDocument("hello: world\ntest: 123");
console.log("YAML successfully parsed safe payload.");
EOF
node baseline.js

echo "--- executing exploit script ---"
cd exploit_files
bash exploit.sh || true

echo "--- verifying exploit succeeded ---"
cd ../verify_files
bash verify.sh || {
    echo "--- diagnostic output on failure ---"
    cat ../exploit_files/error.log || echo "error.log missing"
    exit 1
}
`

	return ctr.WithExec([]string{"bash", "-c", script}).Stdout(ctx)
}
