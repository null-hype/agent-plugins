#!/bin/bash

# The 'test/_global' folder is a special test folder that is not tied to a
# single feature.
#
# This test file is executed against a running container constructed from
# the value of 'cit-96-taint-trace' in test/_global/scenarios.json, built
# from test/_global/cit-96-taint-trace/Dockerfile (devenv-linear-agent base
# + pkl via mise). It proves CIT-96's exact-value-leak detection primitive
# (pkl/Scope.pkl) against a REAL `pass-cli item view` acquisition of a
# synthetic-secret test vault item -- pass://test/cit-96/synthetic-secret
# (never a real credential) -- rather than the offline
# `fake_pass_cli_item_view` simulation hk/capture-taint-trace.sh uses for
# the no-live-session `hk check` path. Both feed the exact same Pkl schema/
# facts pipeline (pkl/Scope.pkl, pkl/Scope.test.pkl) -- this scenario is an
# additional, real-CLI-backed proof, not a replacement for the offline one.
#
# Run with (from the root of this repo):
#    devcontainer features test --global-scenarios-only .

set -e

source dev-container-features-test-lib

if [ -z "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:-}" ]; then
    echo "Skipping cit-96-taint-trace: PROTON_PASS_PERSONAL_ACCESS_TOKEN not set."
    reportResults
    exit 0
fi

# pkl/Scope.pkl, pkl/Scope.test.pkl, and hk/check-taint-trace-fail-closed.sh
# are baked into the image at /opt/cit-96 (see this scenario's Dockerfile) --
# `devcontainer features test` doesn't live-mount the repo the way a normal
# `devcontainer up` does, confirmed live, so there's nothing to find here.
DEVBASE_DIR="/opt/cit-96"

MISE="/root/.local/bin/mise"
OUT_DIR="$DEVBASE_DIR/build"
# The observed-JSON files below contain the acquired synthetic secret verbatim
# (CIT-96 acceptance criterion: "protected local observed-JSON"). Default
# umask (022) would leave them world-readable, so lock the directory and every
# file created under it down to owner-only.
umask 077
mkdir -p "$OUT_DIR"

export PROTON_PASS_SESSION_DIR="/tmp/pass-agent-scenario"
pass-cli login
pass-cli info

GRANT_ID="grant-cit96-live-0001"
HOLDER_AGENT="agent-project-discovery"
OTHER_AGENT="agent-unrelated-task"
RELEASED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

export PROTON_PASS_AGENT_REASON="$HOLDER_AGENT scenario: cit-96-taint-trace live acquisition"

# The real acquisition: `item view` against the synthetic-secret test item,
# same command shape Scope.pkl's `source` field documents (see
# hk/capture-taint-trace.sh's header comment for why `item view`, not
# `run`, is the leak-relevant seam -- it has no output-masking flag).
acquired_value="$(pass-cli item view --vault-name test --item-title cit-96 --field synthetic-secret)"

# Deliberately never pass $acquired_value as a command-line argument anywhere
# in this script (including to `check`) -- devcontainer CLI's own verbose
# logging has already been observed to echo command lines verbatim, and this
# value must never appear in one. Only pass a precomputed boolean.
if [ -n "$acquired_value" ]; then
    check "pass-cli item view returned a non-empty value" true
else
    check "pass-cli item view returned a non-empty value" false
fi

acquisitions_json="$(jq -n \
  --arg grantId "$GRANT_ID" \
  --arg holderAgent "$HOLDER_AGENT" \
  --arg value "$acquired_value" \
  --arg releasedAt "$RELEASED_AT" \
  --arg source "pass-cli item view --vault-name test --item-title cit-96 --field synthetic-secret" \
  '[{grantId: $grantId, holderAgent: $holderAgent, value: $value, releasedAt: $releasedAt, source: $source}]')"

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

destinations_json="$(jq -n \
  --arg grantId "$GRANT_ID" \
  --arg holderAgent "$HOLDER_AGENT" \
  --arg otherAgent "$OTHER_AGENT" \
  --arg value "$acquired_value" \
  --arg t "$(now)" \
  '[
    {kind: "authorizedSink", holderAgent: $holderAgent, grantId: $grantId, content: ("DB_PASSWORD=" + $value), observedAt: $t},
    {kind: "holderTranscript", holderAgent: $holderAgent, grantId: $grantId, content: ("assistant: the value I fetched is " + $value), observedAt: $t},
    {kind: "otherAgentContext", holderAgent: $otherAgent, grantId: $grantId, content: ("shared context mentions " + $value), observedAt: $t},
    {kind: "supervisorReport", holderAgent: $holderAgent, grantId: $grantId, content: ("summary of run included " + $value), observedAt: $t},
    {kind: "linearComment", holderAgent: $holderAgent, grantId: $grantId, content: ("posted as a comment: " + $value), observedAt: $t},
    {kind: "networkPayload", holderAgent: $holderAgent, grantId: $grantId, content: ("POST body contained " + $value), observedAt: $t}
  ]')"

jq -n --argjson acquisitions "$acquisitions_json" --argjson destinations "$destinations_json" \
  '{acquisitions: $acquisitions, destinations: $destinations}' > "$OUT_DIR/taint-trace-observed.json"

clean_destinations_json="$(echo "$destinations_json" | jq '[.[0]]')"
jq -n --argjson acquisitions "$acquisitions_json" --argjson destinations "$clean_destinations_json" \
  '{acquisitions: $acquisitions, destinations: $destinations}' > "$OUT_DIR/taint-trace-clean-observed.json"

pass-cli logout || true

# Reuse hk/check-taint-trace-fail-closed.sh for the fail-closed fixtures --
# no live session needed for those, same as the offline path.
bash "$DEVBASE_DIR/hk/check-taint-trace-fail-closed.sh"

check "the CIT-96 Scope.pkl facts pass against the real pass-cli-captured trace" bash -c \
  "cd '$DEVBASE_DIR/pkl' && $MISE exec -- pkl test Scope.test.pkl"

# Report result
reportResults
