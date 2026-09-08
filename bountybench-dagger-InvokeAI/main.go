package main

import (
	"context"
	"fmt"

	"dagger/bountybench-dagger-InvokeAI/internal/dagger"
)

const (
	bountytasksRepo = "https://github.com/bountybench/bountytasks.git"
	taskDir         = "InvokeAI"
	bountyDir       = "bounties/bounty_0"
)

type BountybenchDaggerInvokeAi struct{}

// Source clones bountybench/bountytasks and initializes the InvokeAI task's
// codebase submodule, returning the InvokeAI/ directory.
// It also extracts the vulnerable_commit from bounty_metadata.json and checks it out.
func (m *BountybenchDaggerInvokeAi) Source() *dagger.Directory {
	return dag.Container().
		From("alpine/git:latest").
		WithExec([]string{"apk", "add", "--no-cache", "jq"}).
		WithWorkdir("/src").
		WithExec([]string{"git", "clone", "--depth", "1", bountytasksRepo, "repo"}).
		WithWorkdir("/src/repo").
		WithExec([]string{"git", "submodule", "update", "--init", "--depth", "1", taskDir + "/codebase"}).
		WithWorkdir("/src/repo/" + taskDir).
		WithExec([]string{"sh", "-c", `
			COMMIT=$(jq -r .vulnerable_commit bounties/bounty_0/bounty_metadata.json)
			cd codebase
			if echo "$COMMIT" | grep -q "^v"; then
				git fetch --depth 1 origin tag "$COMMIT"
				git checkout "tags/$COMMIT"
			else
				git fetch --depth 1 origin "$COMMIT"
				git checkout "$COMMIT"
			fi
		`}).
		Directory("/src/repo/" + taskDir)
}

// app builds the invokeai service, matching docker-compose.yml
// clearExecstackScript clears the PT_GNU_STACK executable flag on onnxruntime's
// prebuilt .so files. This sandbox's kernel refuses to grant an executable
// stack ("cannot enable executable stack as shared object requires: Invalid
// argument"), and neither the `execstack` package nor this binutils's `elfedit`
// support flipping the flag directly, so patch the ELF program header by hand
// (stdlib only, no extra tools needed).
const clearExecstackScript = `
import struct, glob

PT_GNU_STACK = 0x6474e551
PF_X = 0x1

for path in glob.glob("/usr/local/lib/python3.11/site-packages/onnxruntime/**/*.so", recursive=True):
    with open(path, "r+b") as f:
        data = bytearray(f.read())
        if data[:4] != b"\x7fELF" or data[4] != 2:
            continue
        e_phoff = struct.unpack_from("<Q", data, 32)[0]
        e_phentsize = struct.unpack_from("<H", data, 54)[0]
        e_phnum = struct.unpack_from("<H", data, 56)[0]
        changed = False
        for i in range(e_phnum):
            off = e_phoff + i * e_phentsize
            p_type = struct.unpack_from("<I", data, off)[0]
            if p_type == PT_GNU_STACK:
                p_flags = struct.unpack_from("<I", data, off + 4)[0]
                if p_flags & PF_X:
                    struct.pack_into("<I", data, off + 4, p_flags & ~PF_X)
                    changed = True
        if changed:
            f.seek(0)
            f.write(data)
            print("patched", path)
`

func (m *BountybenchDaggerInvokeAi) app(src *dagger.Directory) *dagger.Container {
	return src.DockerBuild(dagger.DirectoryDockerBuildOpts{
		Dockerfile: "Dockerfile",
	}).
		WithNewFile("/clear_execstack.py", clearExecstackScript).
		WithExec([]string{"python3", "/clear_execstack.py"})
}

// Serve wires the app service as described in docker-compose.yml.
func (m *BountybenchDaggerInvokeAi) Serve() *dagger.Service {
	src := m.Source()

	return m.app(src).
		WithEnvVariable("INVOKEAI_HOST", "0.0.0.0").
		WithExposedPort(9090).
		AsService(dagger.ContainerAsServiceOpts{UseEntrypoint: true})
}

// Bootstrap builds the InvokeAI task, runs it, then executes
// the setup, exploit and verify scripts to reproduce bounty_0.
func (m *BountybenchDaggerInvokeAi) Bootstrap(ctx context.Context) (string, error) {
	src := m.Source()
	setupFiles := src.Directory(bountyDir + "/setup_files")
	exploitFiles := src.Directory(bountyDir + "/exploit_files")
	verifyFiles := src.Directory(bountyDir + "/verify_files")

	// The verification script does `docker exec invokeai sh -c '[ -e /tmp/hacked ]'`,
	// meaning it looks for the /tmp/hacked file on the service container.
	// Since we can't easily docker exec into the service, we can mount a shared volume.
	cacheVol := dag.CacheVolume("invokeai-tmp")

	appSvc := m.app(src).
		WithEnvVariable("INVOKEAI_HOST", "0.0.0.0").
		WithMountedCache("/tmp", cacheVol).
		WithExposedPort(9090).
		AsService(dagger.ContainerAsServiceOpts{UseEntrypoint: true})

	// Client container to run the scripts
	ctr := dag.Container().
		From("alpine:3.19").
		WithExec([]string{"apk", "add", "--no-cache", "bash", "curl", "docker-cli"}).
		WithMountedDirectory("/setup_files", setupFiles).
		WithMountedDirectory("/exploit_files", exploitFiles).
		WithMountedDirectory("/verify_files", verifyFiles).
		WithMountedCache("/invokeai_tmp", cacheVol).
		WithServiceBinding("invokeai", appSvc)

	// Since setup_bounty_env.sh and verify.sh use `docker exec invokeai ...`, we need to mock docker.
	// `docker exec invokeai touch /tmp/hacked` -> we can run it against the cache mount.
	mockDocker := `#!/bin/bash
if [ "$1" = "exec" ] && [ "$2" = "invokeai" ]; then
	shift 2
	new_args=()
	for arg in "$@"; do
		new_args+=("${arg//\/tmp//invokeai_tmp}")
	done
	"${new_args[@]}"
else
	/usr/bin/docker "$@"
fi
`

	script := fmt.Sprintf(`set -e
echo "--- wait for app to start ---"
for i in $(seq 1 30); do
	if curl -s http://invokeai:9090 > /dev/null; then
		echo "app is up!"
		break
	fi
	sleep 2
done

echo "--- setup ---"
cd /setup_files
bash setup_bounty_env.sh

echo "--- exploit ---"
cd /exploit_files
bash exploit.sh

sleep 2

echo "--- verify ---"
cd /verify_files
bash verify.sh
`)

	return ctr.
		WithNewFile("/usr/local/bin/docker", mockDocker, dagger.ContainerWithNewFileOpts{
			Permissions: 0755,
		}).
		WithExec([]string{"bash", "-c", script}).Stdout(ctx)
}
