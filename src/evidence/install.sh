#!/bin/sh
set -e

echo "Activating feature 'evidence'"

# Runtime: python3 (adapter), curl + ca-certificates (fetch pkl) and the pkl
# binary itself. Pkl is authoritative for the evidence format, so the format
# check needs it at run time.
need=""
# The adapter needs the full stdlib (subprocess, shutil, tempfile, http.server);
# a python3-minimal base image lacks some of it, so probe rather than assume.
python3 -c "import subprocess, shutil, tempfile, http.server" >/dev/null 2>&1 || need="$need python3"
command -v curl >/dev/null 2>&1 || need="$need curl"
[ -d /etc/ssl/certs ] || need="$need ca-certificates"
if [ -n "$need" ]; then
    if command -v apt-get >/dev/null 2>&1; then
        apt-get update -y && apt-get install -y --no-install-recommends $need
    else
        echo "$need required and no supported package manager was found" >&2
        exit 1
    fi
fi

PKL_VERSION="${PKLVERSION:-0.32.1}"
case "$(uname -m)" in
    x86_64|amd64) PKL_ARCH=amd64; PKL_SHA=3180b62da95c0cad1d904e9bb6c5f4a8f9032413c21e53194bb91ff1ee5f3211 ;;
    aarch64|arm64) PKL_ARCH=aarch64; PKL_SHA=a76d2dd47da435a8f911b0347373f47c7e59ea54fb75ff846d20b8df10dba058 ;;
    *) echo "unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac
if [ -f /etc/alpine-release ]; then
    echo "alpine (musl) is not supported: the glibc pkl binary will not run" >&2
    exit 1
fi

if ! command -v pkl >/dev/null 2>&1; then
    tmp="$(mktemp)"
    curl -fsSL -o "$tmp" "https://github.com/apple/pkl/releases/download/${PKL_VERSION}/pkl-linux-${PKL_ARCH}"
    # The pinned checksums are for the default version only; a different
    # pklVersion must be verified by the caller.
    if [ "$PKL_VERSION" = "0.32.1" ]; then
        echo "${PKL_SHA}  ${tmp}" | sha256sum -c -
    else
        echo "warning: pkl ${PKL_VERSION} is not checksum-pinned by this feature" >&2
    fi
    install -m 0755 "$tmp" /usr/local/bin/pkl
    rm -f "$tmp"
fi

FEATURE_DIR="$(cd "$(dirname "$0")" && pwd)"
SHARE=/usr/local/share/evidence
mkdir -p "$SHARE/pkl" "$SHARE/lib"
install -m 0644 "$FEATURE_DIR"/pkl/*.pkl "$SHARE/pkl/"
install -m 0644 "$FEATURE_DIR"/lib/*.py "$SHARE/lib/"
install -m 0755 "$FEATURE_DIR/evidence-validate" /usr/local/bin/evidence-validate
