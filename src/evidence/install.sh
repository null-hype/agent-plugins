#!/bin/sh
set -e

echo "Activating feature 'evidence'"

if ! command -v python3 >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
        apt-get update -y && apt-get install -y --no-install-recommends python3
    else
        echo "python3 is required and no supported package manager was found" >&2
        exit 1
    fi
fi

FEATURE_DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p /usr/local/share/evidence
install -m 0644 "$FEATURE_DIR/evidence.schema.json" /usr/local/share/evidence/evidence.schema.json
install -m 0755 "$FEATURE_DIR/evidence-validate" /usr/local/bin/evidence-validate
