#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
    echo "Usage: $0 <search-term> [--json]"
    exit 1
fi

TERM_QUERY="$1"
shift || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

export PROTON_PASS_SESSION_DIR="${PROTON_PASS_SESSION_DIR:-/tmp/pass-agent-antigravity}"
export PROTON_PASS_AGENT_REASON="Search Linear workspace for '${TERM_QUERY}'"

pass-cli run --env-file "${SCRIPT_DIR}/linear.env" -- python3 "${SCRIPT_DIR}/search_linear.py" "${TERM_QUERY}" "$@"
