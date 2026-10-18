#!/usr/bin/env bash
# The image's start command (Render runs it as is): the server, with its
# secrets resolved from Proton Pass through linear-agent.env -- the same
# file start-linear-agent.sh uses on the devpod box. pass-cli logs in with
# PROTON_PASS_PERSONAL_ACCESS_TOKEN from the environment.
set -euo pipefail

export PROTON_PASS_KEY_PROVIDER="${PROTON_PASS_KEY_PROVIDER:-fs}"
export PROTON_PASS_AGENT_REASON="linear-agent: fetch webhook server secrets"
pass-cli info >/dev/null 2>&1 || timeout 2m pass-cli login

cd /app
exec pass-cli run --env-file /app/linear-agent.env -- node dist/index.js
