
# Delta Personal Runner (delta)

Install Delta on Debian 13 and optionally serve a Personal Runner after sign-in.

## Example Usage

```json
"features": {
    "ghcr.io/null-hype/agent-plugins/delta:1": {}
}
```

## Options

| Options Id | Description | Type | Default Value |
|-----|-----|-----|-----|
| runner | Serve this workspace as a Personal Runner when signed in. | boolean | false |
| runnerName | Stable name shown in Delta's runner picker. Choose a distinct name for each workspace. | string | delta-workspace |

# Delta Personal Runner

Requires Debian 13 (or a system with the glibc version required by Delta).
Installs the stable release using Delta's official installer.

Set `runner` to `true` to enable startup. It defaults to `false`.
Set `runnerName` to a distinct, stable workspace name (default:
`delta-workspace`). The runner uses this name instead of the container hostname.
DevPod (v0.6.15) does not run a Feature's own `postStartCommand`, so a
devcontainer.json used with DevPod calls `delta-runner-start` from its own
`postStartCommand` too. Running it twice is safe: the runner holds a lock.

On first start, an unsigned-in runner logs a skip rather than opening a browser
or failing startup. As the remote user, run:

```sh
delta auth login
delta-runner-start
```

Approve the sign-in using the URL Delta prints. The runner then appears in
Delta's runner picker. Inspect `~/.local/share/delta/runner.log` for startup
messages and runner output. The process detaches from the startup hook.

Delta is installed under `/usr/local/share/delta` for every user. At start,
`~/.local/share/delta` is linked to `/var/lib/delta`, mounted from the named volume
`delta-${devcontainerId}`. The volume is workspace-specific and survives
container rebuilds; deleting it removes the saved sign-in and local Delta state.
Do not share this volume between workspaces.

Installation, signed-out startup, and mount writability are covered by feature
tests. They do not prove a live model turn or that credentials remain usable
after a rebuild; those require a separately approved live sign-in.


---

_Note: This file was auto-generated from the [devcontainer-feature.json](https://github.com/null-hype/agent-plugins/blob/main/src/delta/devcontainer-feature.json).  Add additional notes to a `NOTES.md`._
