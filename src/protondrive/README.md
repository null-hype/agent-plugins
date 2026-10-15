
# Proton Drive CLI (protondrive)

Installs a pinned, checksum-verified Proton Drive CLI (`proton-drive`) that keeps its session in Unix `pass` (GPG) instead of a desktop keyring, so it works in a headless container.

## Example Usage

```json
"features": {
    "ghcr.io/null-hype/agent-plugins/protondrive:1": {}
}
```

## What it installs

- `proton-drive` 0.9.0 from `proton.me/download/drive/cli`, verified against the published SHA-512 (Linux x64 with AVX2, and arm64). The installer rejects x64 hosts without AVX2 before changing packages; the pinned release index does not publish a baseline-build checksum.
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

The example creates a key without a passphrase for a disposable demonstration.
GPG encrypts the stored session; it does not replace the initial browser login.
Unix `pass` is separate from Proton Pass.

For a persistent setup, keep the runtime user's GPG keyring (`GNUPGHOME`, normally
`~/.gnupg`) and password store (`PASSWORD_STORE_DIR`, normally
`~/.password-store`) in protected persistent storage. Run the CLI as that same
user with those locations and `PROTON_DRIVE_CREDENTIALS_STORE=pass` available.
A passphrase-protected key requires a working gpg-agent unlock mechanism; after
its cache expires or the container restarts, unattended commands may fail until
the key is unlocked again. The retained scenario uses an unprotected throwaway
key and does not demonstrate protected-key unlock across restarts.

## Verification scope

The retained 0.9.0 runs and exact commands are documented in
[`test/protondrive/fixtures`](../../test/protondrive/fixtures/README.md).
They demonstrate transfer and restoration of authored investigation inputs.
CI checks installation; the browser-authorized live scenario is skipped unless
explicitly enabled. Neither those records nor this feature demonstrate running
a checker on the restored evidence: that remains CIT-392's acceptance work.
This slice installs the CLI and session-store tools; the agent plugin and native
editor adapter are supplied by subsequent integration work.
