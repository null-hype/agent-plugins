#!/bin/bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
: "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:?Live agent scenario requires a token}"
export PROTON_PASS_KEY_PROVIDER=fs
export PROTON_PASS_SESSION_DIR=$(mktemp -d)
export PROTON_PASS_AGENT_REASON='proposer local scenario: exercise the installed role on the Rails ontology'
trap 'pass-cli logout >/dev/null 2>&1 || true' EXIT
pass-cli login
pass-cli info
work=$(mktemp -d)
pass-cli run --env-file "$here/agent.env" -- rails-experiment "$here/Case.pkl" "$work/proposer" --role proposer
