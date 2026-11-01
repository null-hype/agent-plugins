
# My Favorite Color (pass-cli)

A feature to remind you of your favorite color

## Example Usage

```json
"features": {
    "ghcr.io/null-hype/agent-plugins/pass-cli:1": {}
}
```

## Options

| Options Id | Description | Type | Default Value |
|-----|-----|-----|-----|
| favorite | Choose your favorite color. | string | red |
| model | Model the 'color' bin uses for its pass-cli-authenticated claude call (see src/pass-cli/install.sh). | string | haiku |
| effort | Effort level the 'color' bin uses for its pass-cli-authenticated claude call. | string | low |
| tag | restic snapshot tag the 'color' bin uses when it backs up ~/.claude. | string | color |
| session | Claude session id that 'color start' (the postStartCommand) continues on container start, in acceptEdits mode with Remote Control, when /workspaces/.color-session does not name one. Leave it empty in a shared config; empty with no file does nothing. | string | - |

# Notes

## `color`'s restic backup output (CIT-147)

When `color` runs its restic backup of `~/.claude` (see `install.sh`), it
writes `restic backup`'s own `--json` output to `/tmp/pass-cli-restic-backup.json`
inside the container. The trailing `{"message_type":"summary",...}` line in
that file carries `snapshot_id`: the exact snapshot this invocation produced.

A caller that needs to know precisely which snapshot `color` just created
(rather than querying `restic snapshots --tag <tag>` and guessing, which a
shared/persistent restic repo can make ambiguous across concurrent or
historical runs) should read this file instead of the tag listing. See
`test/pass-cli/restic-backup.sh` for the reference consumer.

This file is overwritten on every `color` invocation that reaches the
backup step; it is not cleaned up automatically.


---

_Note: This file was auto-generated from the [devcontainer-feature.json](https://github.com/null-hype/agent-plugins/blob/main/src/pass-cli/devcontainer-feature.json).  Add additional notes to a `NOTES.md`._
