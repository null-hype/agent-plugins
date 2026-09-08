// A Dagger module that bootstraps a single application from the
// bountybench/bountytasks corpus (https://github.com/bountybench/bountytasks).
//
// It targets undici/bounties/bounty_0: an HTTP proxy-authorization header leak.
package main

import (
	"context"

	"dagger/bountybench-dagger-undici/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "undici"
	bountyDir       = "bounties/bounty_0"
)

type BountybenchDaggerUndici struct{}

// Source clones bountybench/bountytasks and initializes the undici task's
// codebase submodule (the public cy-suite/undici fork), returning the
// undici/ directory -- the build context the task's own Dockerfiles expect.
func (m *BountybenchDaggerUndici) Source() *dagger.Directory {
	return dag.Container().
		From("alpine/git:latest").
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
		WithWorkdir("/src/repo/" + taskDir + "/codebase").
		// The bountytasks submodule pointer is often already-patched; pin to
		// the exact vulnerable_commit from bounty_metadata.json (a tag here).
		WithExec([]string{"sh", "-c", "git fetch --depth 1 origin tag v6.11.0 && git checkout tags/v6.11.0"}).
		WithWorkdir("/src/repo").
		Directory("/src/repo/" + taskDir)
}

// undiciRedirectTarget builds the vulnerable undici server from the bounty's Dockerfile.
func (m *BountybenchDaggerUndici) undiciRedirectTarget(src *dagger.Directory) *dagger.Container {
	return src.DockerBuild(dagger.DirectoryDockerBuildOpts{
		Dockerfile: bountyDir + "/setup_files/Dockerfile",
	})
}

// Serve returns the built undici app as a running Service on port 8001.
func (m *BountybenchDaggerUndici) Serve() *dagger.Service {
	src := m.Source()
	return m.undiciRedirectTarget(src).
		WithExposedPort(8001).
		AsService()
}

// Bootstrap builds the undici bounty_0 task, boots the undici server using the built image,
// replays the task's own exploit verbatim, and checks that the proxy-authorization
// header is leaked as expected.
//
// exploit.sh installs its own Node via nvm, which downloads a glibc-linked
// binary -- that can't run in the target's own node:20-alpine (musl)
// container ("libatomic.so.1: No such file or directory"). The original
// harness clearly runs the exploit client as a separate process from the
// target service anyway (solution_redirect_server.js/solution_client.js
// just need network access to "undici-redirect-target:8001", not to share
// its filesystem/libc), so we run the target as its own alpine service and
// the exploit in a separate glibc node:20 container, sharing a cache volume
// in place of "docker logs" (mirrors the same pattern used for InvokeAI's
// analogous docker-exec/docker-logs harness gap).
func (m *BountybenchDaggerUndici) Bootstrap(ctx context.Context) (string, error) {
	src := m.Source()
	logVol := dag.CacheVolume("undici-target-log")

	targetService := m.undiciRedirectTarget(src).
		WithMountedCache("/shared", logVol).
		WithExposedPort(8001).
		AsService(dagger.ContainerAsServiceOpts{
			Args: []string{"sh", "-c", "node undici_server.js > /shared/undici.log 2>&1"},
		})

	ctr := dag.Container().
		From("node:20").
		WithExec([]string{"apt-get", "update"}).
		WithExec([]string{"apt-get", "install", "-y", "curl"}).
		WithServiceBinding("undici-redirect-target", targetService).
		WithMountedCache("/shared", logVol).
		WithMountedDirectory("/undici", src).
		WithWorkdir("/undici/" + bountyDir + "/exploit_files")

	script := `set -e

echo "--- waiting for undici server to be responsive ---"
WAIT_TIME=0
while [ $WAIT_TIME -lt 30 ]; do
  if curl -s http://undici-redirect-target:8001/ -o /dev/null -w "%{http_code}" 2>/dev/null | grep -q 200; then
    echo "undici server is ready"
    break
  fi
  sleep 1
  WAIT_TIME=$((WAIT_TIME + 1))
done

echo "--- pinning nvm's 'latest' install to a CVE-2024-30260-era Node build ---"
# exploit.sh's own "nvm install node" always resolves the true latest release
# regardless of aliases -- by this sandbox's clock that's Node 26, whose
# bundled internal undici rejects the vulnerable fork's now-removed
# maxRedirections option. Since we can't make "nvm install node" itself
# resolve to an older version without editing exploit.sh, pre-install
# "latest" ourselves, then replace ITS binaries with symlinks to a
# period-appropriate LTS (20.15.1, a 2024 release) -- exploit.sh's own
# "nvm install node" will see that version directory already present, skip
# re-fetching, and "nvm use" it, transparently getting the pinned old Node.
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install node
LATEST_DIR="$NVM_DIR/versions/node/$(nvm current)"
nvm install 20.15.1
PINNED_DIR="$NVM_DIR/versions/node/v20.15.1"
for bin in node npm npx; do
  ln -sf "$PINNED_DIR/bin/$bin" "$LATEST_DIR/bin/$bin"
done

echo "--- running bounty_0 exploit verbatim ---"
bash exploit.sh > /tmp/exploit.log 2>&1 || true
cat /tmp/exploit.log

# Wait a moment for logs to flush
sleep 2

echo "--- executing verification verbatim ---"
cd ../verify_files
# verify.sh uses 'docker ps' and 'docker logs' to check the target server's
# output; mock the docker CLI to return the shared-cache-volume log instead.
mkdir -p /usr/local/bin
cat << 'MOCK' > /usr/local/bin/docker
#!/bin/bash
if [ "$1" = "ps" ]; then
  echo "mock_id"
elif [ "$1" = "logs" ]; then
  cat /shared/undici.log
fi
MOCK
chmod +x /usr/local/bin/docker

bash verify.sh
`

	return ctr.WithExec([]string{"bash", "-c", script}).Stdout(ctx)
}
