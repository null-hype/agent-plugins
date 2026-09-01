# JIN-63 remediation runbook — rotate + prune leaked secrets

Context: the Claude session that worked JIN-63 printed the full contents of the
`development/restic` pass-cli item (GCP service-account private key PEM,
`RESTIC_REPOSITORY`, `RESTIC_PASSWORD`) and a live `GITHUB_TOKEN` /
`GITHUB_CODESPACE_TOKEN` to its own transcript, then backed that transcript up
into the shared production restic repo (`gs:briskly-trance:/`, tag
`claude-code-session`/`jin-63`, snapshot `488398a1`, pushed 2026-08-24 22:25 UTC).
That repo is read by `devpod-keepalive.sh`, `devpod-gce.sh`, and the reconciler,
so treat the key and password as burned.

These steps are **not yet executed** — this is a draft for review/execution
with real credentials, since they touch live GCP IAM and the shared restic repo.

## 1. Rotate the GCP service account key

Vault: `development`, item `restic`, field `GCP_SERVICE_ACCOUNT_KEY`.
Project: `caldav-444421` (per the prior investigation).

```bash
pass-cli login
pass-cli run --env-file <(echo development/restic) -- bash -c '
  echo "$GCP_SERVICE_ACCOUNT_KEY" > /tmp/old-key.json
  SA_EMAIL=$(jq -r .client_email /tmp/old-key.json)
  OLD_KEY_ID=$(jq -r .private_key_id /tmp/old-key.json)
  echo "service account: $SA_EMAIL"
  echo "old key id to revoke after cutover: $OLD_KEY_ID"
'

# 1a. Mint a new key
gcloud iam service-accounts keys create /tmp/new-key.json \
  --iam-account="$SA_EMAIL" --project=caldav-444421

# 1b. Store the new key in pass-cli, replacing the old field value
pass-cli item edit --vault-name development --item-title restic \
  --field GCP_SERVICE_ACCOUNT_KEY --value "$(cat /tmp/new-key.json)"

# 1c. Revoke the OLD key (the one that leaked) — only after confirming
#     devpod-keepalive/devpod-gce runs succeed against the new key
gcloud iam service-accounts keys delete "$OLD_KEY_ID" \
  --iam-account="$SA_EMAIL" --project=caldav-444421

shred -u /tmp/old-key.json /tmp/new-key.json
```

## 2. Rotate RESTIC_PASSWORD

This password protects the shared repo at `gs:briskly-trance:/` used by
`devpod-keepalive.sh` / `devpod-gce.sh` / `continue-claude-session.sh` for both
`devpod-state` and `claude-session-state` snapshots. Changing it requires
`restic key add` + `restic key remove` (restic supports multiple passwords per
repo, so this can be done without downtime):

```bash
pass-cli run --env-file <(echo development/restic) -- bash -c '
  restic key add            # prompts for the NEW password twice
'
# Update the pass-cli field to the new password
pass-cli item edit --vault-name development --item-title restic \
  --field RESTIC_PASSWORD --value "<new password>"

# Once every consumer (devpod-keepalive cron, devpod-gce, any devpod boxes
# with continue-claude-session.sh) has picked up the new password on its
# next run, remove the old key id:
RESTIC_PASSWORD="<new password>" restic key list
RESTIC_PASSWORD="<new password>" restic key remove <old-key-id>
```

## 3. Forget/prune the compromised transcript snapshot

```bash
pass-cli run --env-file <(echo development/restic) -- bash -c '
  restic snapshots --tag claude-code-session --tag jin-63
  # confirm 488398a1 (or its full id) is the only match, then:
  restic forget 488398a1 --prune
'
```

Note: forgetting/pruning removes it from *future* restores, but anyone who
already restored snapshot `488398a1` (this investigation did, to confirm the
leak) has a local plaintext copy — check `~/.claude` on the box(es) used for
that restore and shred the restored PEM/session file there too.

## 4. Check the GitHub tokens

`GITHUB_TOKEN`/`GITHUB_CODESPACE_TOKEN` from Codespace `codespaces-3b7ff1` were
printed at transcript line 285. Codespace tokens are normally scoped to the
Codespace's lifetime — confirm that Codespace is stopped/deleted:

```bash
gh codespace list --json name,state | jq '.[] | select(.name | contains("3b7ff1"))'
gh codespace stop -c <name>   # or: gh codespace delete -c <name>
```

If it's already stopped, the token is almost certainly dead — no separate PAT
rotation needed unless it was a long-lived personal token rather than the
Codespace-issued one.

## 5. Prevent recurrence

The env-inheritance fix (`env -u ...` in `continue-claude-session.sh`, already
applied) stops secrets being silently handed to a resumed session's
environment. It does **not** stop an agent from deliberately fetching and
printing a secret mid-session, or from backing up a transcript that contains
one. Two independent hardening options, worth a separate follow-up decision
rather than bundling here:

- Have `gce_common_restic_push_claude_session` grep the transcript for known
  secret patterns (PEM headers, the vault's known field names) before backup
  and refuse/redact instead of pushing.
- Point `pass-cli item view` calls used for debugging at `--field` (single
  value) rather than `--output json` (whole item), so a debugging session
  can't dump the full item in one shot.
