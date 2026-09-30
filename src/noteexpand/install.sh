#!/bin/sh
set -eu

FEATURE_DIR="$(cd "$(dirname "$0")" && pwd)"
CASE_HOME=/usr/local/share/noteexpand

if ! python3 -c 'import venv, ensurepip' >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y --no-install-recommends python3 python3-venv curl ca-certificates
fi

if ! command -v pkl >/dev/null 2>&1; then
    case "$(uname -m)" in
        x86_64|amd64) arch=amd64; sha=3180b62da95c0cad1d904e9bb6c5f4a8f9032413c21e53194bb91ff1ee5f3211 ;;
        aarch64|arm64) arch=aarch64; sha=a76d2dd47da435a8f911b0347373f47c7e59ea54fb75ff846d20b8df10dba058 ;;
        *) echo "unsupported architecture $(uname -m)" >&2; exit 1 ;;
    esac
    tmp="$(mktemp)"
    curl -fsSL -o "$tmp" "https://github.com/apple/pkl/releases/download/0.32.1/pkl-linux-${arch}"
    echo "$sha  $tmp" | sha256sum -c -
    install -m 0755 "$tmp" /usr/local/bin/pkl
    rm -f "$tmp"
fi

mkdir -p /opt/toy "$CASE_HOME/pkl" "$CASE_HOME/lib"
install -m 0644 "$FEATURE_DIR/app/README.md" /opt/toy/README.md
install -m 0755 "$FEATURE_DIR/app/expander.sh" "$FEATURE_DIR/app/service.sh" /opt/toy/
if [ "${CONFINEINCLUDES:-false}" = "true" ]; then
    install -m 0755 "$FEATURE_DIR/control/service.sh" /opt/toy/service.sh
fi
install -m 0644 "$FEATURE_DIR"/pkl/*.pkl "$CASE_HOME/pkl/"
install -m 0644 "$FEATURE_DIR"/lib/*.py "$CASE_HOME/lib/"
python3 -m venv /usr/local/lib/noteexpand/venv
/usr/local/lib/noteexpand/venv/bin/pip install --quiet "pkl-python==0.1.19"
