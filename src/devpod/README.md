# devpod (devcontainer feature)

Installs `.agent/skills/devpod/.env` — a file of `pass://` references only,
never secret values — at a fixed path so `devpod-gce.sh` and other
devpod/gcloud callers can resolve credentials with:

```sh
pass-cli run --env-file .agent/skills/devpod/.env -- <command>
```

There is no vault-path option. The vault item is fixed so there is exactly
one way to resolve these credentials, not two.

## Required vault items

Before using this feature, populate these vault items:

| Item | Key | Purpose |
| --- | --- | --- |
| `JIN-63/restic` | `GCP_SERVICE_ACCOUNT_KEY` | GCE/restic service account key JSON |
| `JIN-63/restic` | `GOOGLE_PROJECT_ID` | GCP project the devpod GCE workspace lives in |
| `JIN-63/restic` | `RESTIC_REPOSITORY` | restic repository URL used for backups |
| `JIN-63/restic` | `RESTIC_PASSWORD` | restic repository password |
| `JIN-63/gh` | `GITHUB_TOKEN` | token used to clone the devpod workspace's git source |

These are the same vault items `RecreateDevpod`'s ported `gcloud.env` already
pointed at (unchanged from `devenv-base`) — consolidating them under a
single `devpod/gcloud` item is a reasonable follow-up, but renaming them
here would require provisioning a new Pass vault item first, so it's left
out of this change.

If `.agent/skills/devpod/.env` is missing, callers must error out rather
than silently skip — an empty file (all keys present but blank) is legal
and means "no credentials required"; an absent file means the install
never ran.

## Dependencies

This feature only writes a static `pass://`-reference file; it doesn't
itself install a `pass-cli` binary, and needs one on `PATH` at runtime to
be useful. Declared via `installsAfter: ["pass-cli"]` so ordering is
correct when both are present in the same devcontainer.json.

Not `dependsOn`: the devcontainer CLI's local-feature test harness
(`devcontainer features test -f devpod`) resolves a relative `dependsOn`
path against the generated test `devcontainer.json`'s own `.devcontainer/`
directory and refuses to resolve anything outside it ("Local file path
parse error. Resolved path must be a child of the .devcontainer/
folder."), so a same-repo `src/pass-cli` reference can't be expressed as a
hard dependency here without publishing `pass-cli` to a registry first.
`installsAfter` doesn't hit that resolution path, since it's soft ordering
rather than a fetch.
