# Session backups

This is separate from the Render keepalive job, which backs up only `.devpod`.
The existing `claude-session-backup.sh` hook now saves three independent snapshots
in the shared encrypted restic repository:

| Directory | Snapshot tag |
| --- | --- |
| `~/.claude` | `claude-session-state` |
| `~/.config/container-use` | `container-use-state` |
| `~/.codex` (or `CODEX_HOME`) | `codex-session-state` |

The Codex snapshot covers the full directory, including active and archived
session transcripts and their index. These are live file backups, not coordinated
SQLite database snapshots; the transcript JSONL files are included directly.

Run a backup with failure reporting:

```sh
bash .dagger/internal/devenv-base/hk/claude-session-backup.sh
```

The pre-push hooks explicitly pass `--best-effort`: failures are reported but do
not block Git pushes. Other callers receive the actual failure status.

All three backups are attempted independently. Retention runs only after all
three succeed, keeping 50 snapshots per host/path/tag group. A failed backup does
not prune older snapshots or prevent another directory from being backed up.
Restic repository-lock conflicts retry for up to 60 seconds, including retention;
other errors fail immediately. `RESTIC_LOCK_RETRY_SECONDS` overrides that budget.
Active locks are never removed. This supports the installed restic 0.14, which
does not have the newer `--retry-lock` flag.

With the repository credentials loaded, list or restore only Codex:

```sh
restic snapshots --tag codex-session-state
restic restore SNAPSHOT_ID --target /tmp/codex-restore
```

Restore into a separate directory first, then choose the files to recover. The
snapshot is not restored automatically over an active Codex session.

Regression checks (including a real restic lock conflict in a disposable repo):

```sh
python3 .dagger/internal/devenv-base/hk/test_session_backup.py
```
