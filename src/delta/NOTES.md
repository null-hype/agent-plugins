# Delta Personal Runner

Requires Debian 13 (or a system with the glibc version required by Delta).
Installs the stable release using Delta's official installer.

Set `runner` to `true` to enable startup. It defaults to `false`.
The devcontainer CLI rejects `../../src/delta` from the internal config because
local Feature paths must stay within `.devcontainer/`. The internal config
therefore retains its existing installer until this Feature can be published
or packaged into `.devcontainer/` by an explicit build step.

On first start, an unsigned-in runner logs a skip rather than opening a browser
or failing startup. As the remote user, run:

```sh
delta auth login
delta-runner-start
```

Approve the sign-in using the URL Delta prints. The runner then appears in
Delta's runner picker. Inspect `~/.local/share/delta/runner.log` for startup
messages and runner output. The process detaches from the startup hook.

`~/.local/share/delta` links to `/var/lib/delta`, mounted from the named volume
`delta-${devcontainerId}`. The volume is workspace-specific and survives
container rebuilds; deleting it removes the saved sign-in and local Delta state.
Do not share this volume between workspaces.

Installation, signed-out startup, and mount writability are covered by feature
tests. They do not prove a live model turn or that credentials remain usable
after a rebuild; those require a separately approved live sign-in.
