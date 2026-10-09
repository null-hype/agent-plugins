#!/bin/sh
set -e

echo "Activating feature 'protondrive'"

# Pinned CLI release. The checksums are the SHA-512s published alongside
# each build on https://proton.me/download/drive/cli/index.html for this
# version; bump all three together.
PROTON_DRIVE_VERSION="0.9.0"
SHA512_LINUX_X64="3533025ba69ae112b64e3e01fbcc1ad0688136a4043f6cf6a72886967d85fdcd9ec235479c2e113171614be5225bfba93427509a05ca5aa6071d924fa7e91ca8"
SHA512_LINUX_ARM64="c8d5a6b174e57f06d05cb5483400b9963faf58e743b6b33706bb73ecff718047ffce6b439994255b94b5b226b90d2e91bef7418ec96c1c3f5d8bf39b6cd01321"

case "$(uname -m)" in
    x86_64 | amd64)
        PLATFORM="linux-x64"
        SHA512="$SHA512_LINUX_X64"
        ;;
    aarch64 | arm64)
        PLATFORM="linux-arm64"
        SHA512="$SHA512_LINUX_ARM64"
        ;;
    *)
        echo "protondrive: unsupported architecture $(uname -m)" >&2
        exit 1
        ;;
esac

# pass and gnupg are the session store (PROTON_DRIVE_CREDENTIALS_STORE=pass,
# set by this feature's containerEnv). No libsecret or desktop keyring is
# installed: the point of this feature is that the CLI works without one.
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl pass gnupg
rm -rf /var/lib/apt/lists/*

TMP_BIN="$(mktemp)"
curl -fsSL -o "$TMP_BIN" \
    "https://proton.me/download/drive/cli/${PROTON_DRIVE_VERSION}/${PLATFORM}/proton-drive"
echo "${SHA512}  ${TMP_BIN}" | sha512sum -c -
install -m 0755 "$TMP_BIN" /usr/local/bin/proton-drive
rm -f "$TMP_BIN"

# Sign-in is deliberately not done here: no GPG key, pass store or session
# is baked into the image. See README.md for the runtime steps.
