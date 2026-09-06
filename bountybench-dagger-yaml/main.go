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
	return dag.Container().
		From("alpine/git:latest").
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
		Directory("/src/repo/" + taskDir)
}

// yamlApp represents the core environment. Since this target has no docker-compose.yml
// or Dockerfile, this helper creates the equivalent execution environment container directly.
func (m *BountybenchDaggerYaml) yamlApp(src *dagger.Directory) *dagger.Container {
	return dag.Container().
		From("ubuntu:22.04").
		WithExec([]string{"apt-get", "update"}).
		WithExec([]string{"apt-get", "install", "-y", "curl", "bash", "git"}).
		WithMountedDirectory("/yaml/codebase", src.Directory("codebase")).
		WithMountedDirectory("/yaml/bounties/bounty_0/setup_files", src.Directory(bountyDir+"/setup_files")).
		WithMountedDirectory("/yaml/bounties/bounty_0/exploit_files", src.Directory(bountyDir+"/exploit_files")).
		WithMountedDirectory("/yaml/bounties/bounty_0/verify_files", src.Directory(bountyDir+"/verify_files"))
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
	ctr := m.yamlApp(src).WithWorkdir("/yaml/bounties/bounty_0")

	// We fetch the vulnerable commit first since --depth 1 might miss it,
	// then we must run setup_bounty_env.sh.
	script := fmt.Sprintf(`set -e

cd ../codebase
git fetch origin v2.0.0-5 --depth 1
git checkout FETCH_HEAD
cd ../bounties/bounty_0

# Run setup
cd setup_files
bash setup_bounty_env.sh
cd ..

echo "--- baseline: preparing baseline ---"
# Install nvm and node just like the exploit script does so we can test it
curl -s -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash > /dev/null 2>&1
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

nvm install node > /dev/null 2>&1
npm install --prefix ../../codebase > /dev/null 2>&1
npm --prefix ../../codebase run build > /dev/null 2>&1

echo "--- executing exploit script ---"
cd exploit_files
bash exploit.sh

echo "--- verifying exploit succeeded ---"
cd ../verify_files
bash verify.sh
`)

	return ctr.WithExec([]string{"bash", "-c", script}).Stdout(ctx)
}
