#!/usr/bin/env bash
# Render's start command for the supervisor workflow (CIT-472). The service's
# only secret is PROTON_PASS_PERSONAL_ACCESS_TOKEN; the Linear key and the
# rest come from Pass through workflow.env, and never touch Render.
set -euo pipefail
export PATH="$PWD/bin:$PATH"
export PROTON_PASS_KEY_PROVIDER=${PROTON_PASS_KEY_PROVIDER:-fs}
export PROTON_PASS_AGENT_REASON="supervisor workflow: resolve the Linear key, Claude Code token and toolbox token for its tasks"
: "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:?the service holds only the Proton Pass token, and it is not set}"
if ! pass-cli info > /dev/null 2>&1; then
  pass-cli logout --force > /dev/null 2>&1 || true
  pass-cli login > /dev/null
fi
exec pass-cli run --env-file workflow.env -- npm start
