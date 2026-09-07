# DevPod keepalive

The Render cron entrypoint authenticates with Proton Pass and GCP, restores the
shared DevPod state, runs the Go program, and backs up state after success.

The Go program loads the existing workspace mapping and uses DevPod v0.6.15's Go
packages to:

1. Refresh provider options and run `cmd.UpCmd.Run` with no IDE. This starts the
   mapped machine and creates or starts its devcontainer as needed.
2. Require `Status(ContainerStatus: true)` to return `Running`.
3. Execute a command through `tunnel.NewContainerTunnel` that checks `DEVPOD`,
   the workspace ID, and the workspace UID before acknowledging the probe.
4. Run the existing bootstrap scripts through separate container tunnels: generate
   environment files, join Tailscale, install tools, and ensure the Linear agent
   and Cloudflare connector are started. Existing processes are reused. The
   Proton Pass token is forwarded only to `tailscale-up.sh`.
5. Require Tailscale to report `Running` and its node online with an assigned IP.
   Require local and public `/healthz` to report an installed Linear token, and
   require the signed public webhook smoke test to succeed.
6. Await `agent workspace update-config`, the same operation used by DevPod's
   periodic tunnel refresh to update the inactivity watchdog's workspace file.

Every failed operation fails the job. Missing saved workspace mappings fail
instead of being interpreted as a new workspace source. Every bootstrap command
must return a successful exit and a completion marker; a tunnel ending early is
a failure. Bootstrap uses scripts from the workspace checkout under
`.dagger/internal/devenv-base/.devcontainer` (`DEVENV_BASE_DEVCONTAINER_DIR` can
override this path). It does not stop or restart existing application processes.

DevPod does not expose the complete `up` operation in `pkg/client`; the adapter
uses its exported command implementation. Keep the module pin and the build's
`pkg/version.version` linker value aligned. That linker value also selects the
matching remote DevPod agent. The binary also retains DevPod's official commands:
upstream can upload its own executable when the remote agent download fails, so
the uploaded binary must support `agent`, `helper`, and `version`. The keepalive
flow is invoked as `devpod-keepalive keepalive --workspace devenv-base-gce`.

## Validation

```sh
cd .dagger/internal/devenv-base/keepalive/runner
go test ./...
go build -ldflags '-X github.com/loft-sh/devpod/pkg/version.version=v0.6.15' -o /tmp/devpod-keepalive .
cd ..
python3 test_timeout.py
```

`dagger -m .dagger/internal/devenv-base call check-keepalive` also builds and tests
the runner and checks image packaging. These tests use no production credentials.
A live run requires restored DevPod state and authenticated provider credentials;
run the entrypoint in the keepalive image to exercise that complete path.

The default whole-job deadline is 30 minutes (`KEEPALIVE_TIMEOUT`); the Go
workspace operation deadline is 25 minutes. Render's hourly schedule must remain
shorter than the configured DevPod inactivity timeout. Failed or missed jobs can
still allow idle shutdown. The next successful run starts the workspace again.

Publishing the image does not update Render's pinned image reference in
`render.yaml`; deployment must select the newly published image.
