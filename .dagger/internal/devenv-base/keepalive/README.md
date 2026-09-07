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
4. Reconcile the VM’s Tailscale service from the Dagger-built image archive.
   It uses host networking, a dedicated persistent Docker volume, and an
   `always` restart policy. Load the archive only when its content-addressed
   image is missing. Stream the auth key over stdin; never put it in Docker
   environment variables or command arguments.
5. Run the existing bootstrap scripts through separate container tunnels: generate
   environment files, join Tailscale, install tools, and ensure the Linear agent
   and Cloudflare connector are started. Existing processes are reused. The
   Proton Pass token is forwarded only to `tailscale-up.sh`.
6. Require Tailscale to report `Running` and its node online with an assigned IP.
   Require local and public `/healthz` to report an installed Linear token, and
   require the signed public webhook smoke test to succeed.
7. Read Tailscale status independently through the machine and container
   interfaces. Both nodes must be online, have distinct stable node IDs, and
   have no overlapping Tailscale IPs.
8. Await `agent workspace update-config`, the same operation used by DevPod's
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

For routine in-place repair from an authenticated environment:

```sh
dagger -m .dagger/internal/devenv-base call reconcile-devpod --proton-pass-token=env:PROTON_PASS_PERSONAL_ACCESS_TOKEN
```

`RecreateDevpod` remains an explicit destructive reset operation; routine repair
uses `ReconcileDevpod`. The provisioning shell checks for the packaged runner
and VM archive before it can reset anything.

## VM and devcontainer topology

The GCE provider creates a Container-Optimized OS VM. The module’s published
`devenv-linear-agent` image runs **inside** that VM as the DevPod container;
installing a tool in that image does not install it on the VM.

`VmTailscale` builds a small service image from the module’s Tailscale binaries.
`Keepalive` bundles its archive at `/opt/devenv/vm-tailscale.tar`. The Go runner
creates the managed `devenv-vm-tailscale` service on the **outer VM Docker daemon**,
using `--network=host` and the `devenv-vm-tailscale-state` volume. It never mounts
the DevPod’s Tailscale state. Docker restarts the service after a VM reboot.
Managed service image updates preserve the volume; containers without the
ownership label are rejected rather than replaced.

The VM is named `<workspace>-vm` on the tailnet. It leaves DNS and route
acceptance unchanged and uses the VM’s normal sshd, authenticated with the
VM’s existing SSH keys. Tailscale SSH is not enabled in this service container:
that would enter the service container instead of the VM. The DevPod retains
its current hostname, identity, and Tailscale SSH configuration.

Both `RecreateDevpod` and the Render entrypoint invoke the same Go reconciliation.
The provisioning shell still supplies the source and provider configuration;
it no longer has an independent application-bootstrap loop. A standalone runner
requires the Dagger image archive (`VM_TAILSCALE_ARCHIVE` overrides its path).
`TS_AUTHKEY`, resolved from `pass://infra/tailscale/TS_AUTHKEY`, is required when
the VM needs to authenticate. An expired or non-reusable key fails the job.

For live QA, require two node IDs and two address sets, confirm the VM daemon
uses host networking, and rerun to confirm stable identities. Check that existing
Linear agent and Cloudflare PIDs remain unchanged. Listing local DevPod mappings
or checking the VM’s power state alone does not establish this topology.
