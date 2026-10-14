#!/bin/bash
set -euo pipefail
challenger --help
claude --version
test -s /usr/local/share/challenger/role.txt
