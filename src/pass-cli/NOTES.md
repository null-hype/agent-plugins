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
