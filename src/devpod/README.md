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

This feature depends on `pass-cli` (`dependsOn`), since the installed
`.env` file is only useful when resolved through `pass-cli run`.
