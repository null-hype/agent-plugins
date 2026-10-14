#!/bin/sh
set -eu
apt-get update -y
apt-get install -y --no-install-recommends jq ca-certificates
npm install --global --no-audit --no-fund @anthropic-ai/claude-code@2.1.296
mkdir -p /usr/local/share/challenger
install -m 0644 role.txt /usr/local/share/challenger/role.txt
install -m 0755 challenger /usr/local/bin/challenger
