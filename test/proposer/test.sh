#!/bin/bash
set -euo pipefail
proposer --help
claude --version
test -s /usr/local/share/proposer/role.txt
