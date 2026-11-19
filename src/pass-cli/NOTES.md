# Notes

## Installing an agent

The feature installs `pass-cli`. A container logs in as a Pass agent with
that agent's token in `PROTON_PASS_PERSONAL_ACCESS_TOKEN`:

```json
"features": {
    "ghcr.io/null-hype/agent-plugins/pass-cli:1": {}
},
"remoteEnv": {
    "PROTON_PASS_PERSONAL_ACCESS_TOKEN": "${localEnv:PROTON_PASS_PERSONAL_ACCESS_TOKEN}"
}
```

then `pass-cli login`. Create the agent from your own session; its token is
printed once, so send it straight to where the container will read it:

```sh
pass-cli agent create <name> --expiration 1y | jq -er .token |
  gh secret set PROTON_PASS_PERSONAL_ACCESS_TOKEN --env <environment>
```

Grant it items with `pass-cli agent access grant`. CI's `login` scenario
logs in as `ci-login`, an agent with no grants, from the `login-test`
environment.

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
