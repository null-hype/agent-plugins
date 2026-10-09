
# Proton Drive CLI (protondrive)

Installs a pinned, checksum-verified Proton Drive CLI (`proton-drive`) that keeps its session in Unix `pass` (GPG) instead of a desktop keyring, so it works in a headless container.

## Example Usage

```json
"features": {
    "ghcr.io/null-hype/agent-plugins/protondrive:1": {}
}
```

## What it installs

- `proton-drive` 0.9.0 from `proton.me/download/drive/cli`, verified against the published SHA-512 (linux x64 and arm64).
- `pass` and `gnupg`, with `PROTON_DRIVE_CREDENTIALS_STORE=pass` set in the container environment.

It installs no libsecret or desktop keyring, and bakes no GPG key, pass store or session into the image.

## Sign in at runtime

```bash
gpg --batch --passphrase '' --quick-gen-key "you <you@example.com>" default default never
pass init "$(gpg --list-keys --with-colons you@example.com | awk -F: '/^fpr:/ { print $10; exit }')"
proton-drive auth login   # open the printed URL on another device
proton-drive filesystem list --json /my-files
```

The session is stored in pass as `ch.proton.drive/drive-sdk-cli/auth-session`. Each later `proton-drive` process loads it from there.
