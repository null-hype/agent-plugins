#!/usr/bin/env bash
# Drives the CIT-96 concrete scenario end to end and writes its
# observed-JSON for pkl/Scope.test.pkl: a pass-cli-enabled holder agent
# acquires a secret via the real `item view` contract (mandatory
# PROTON_PASS_AGENT_REASON, exact value returned to the caller), then the
# scenario exercises one authorized destination and five export-sink
# destinations against that same acquired value.
#
# Runs with a SYNTHETIC secret end to end -- never a real Proton Pass
# session or vault. `fake_pass_cli_item_view` below stands in for
# `pass-cli item view` itself: it reproduces the one contract this
# primitive depends on (the mandatory-reason requirement, and returning
# the exact value to the caller) without requiring a live account, so this
# scenario is runnable in CI/offline. Swapping in real `pass-cli item
# view` against a live synthetic-secret test vault is a follow-up, not a
# blocker for proving the detection primitive (CIT-96 acceptance:
# "Verify actual pass-cli command/monitor interfaces before choosing the
# capture seam" -- verified live against pass-cli 2.3.2 in this session;
# `item view` has no output-masking flag, unlike `run`, which is why
# `item view` is the leak-relevant seam and `run`'s stdout/stderr masking
# is a separate, already-mitigated path).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$DIR/../build"
OUT="$OUT_DIR/taint-trace-observed.json"
mkdir -p "$OUT_DIR"

GRANT_ID="grant-cit96-demo-0001"
HOLDER_AGENT="agent-project-discovery"
OTHER_AGENT="agent-unrelated-task"
SYNTHETIC_SECRET="synthetic-9f2c1b7e-not-a-real-secret"
RELEASED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Stands in for `pass-cli item view --vault-name ... --item-title ...
# --field password`: refuses without PROTON_PASS_AGENT_REASON (mirroring
# the real CLI's mandatory-reason contract for `item view`/`item
# create`/`item update`/`item trash`/`item untrash`/`vault update`) and
# otherwise echoes the requested synthetic value to stdout, exactly as the
# real command would.
fake_pass_cli_item_view() {
  if [ -z "${PROTON_PASS_AGENT_REASON:-}" ]; then
    echo "error: PROTON_PASS_AGENT_REASON is required for item view" >&2
    return 1
  fi
  printf '%s' "$SYNTHETIC_SECRET"
}

export PROTON_PASS_AGENT_REASON="$HOLDER_AGENT scenario: capture-taint-trace demo acquisition"
acquired_value="$(fake_pass_cli_item_view)"

# --- Acquisition -----------------------------------------------------
acquisitions_json="$(jq -n \
  --arg grantId "$GRANT_ID" \
  --arg holderAgent "$HOLDER_AGENT" \
  --arg value "$acquired_value" \
  --arg releasedAt "$RELEASED_AT" \
  --arg source "pass-cli item view --vault-name Demo --item-title synthetic-secret --field value" \
  '[{grantId: $grantId, holderAgent: $holderAgent, value: $value, releasedAt: $releasedAt, source: $source}]')"

# --- Destinations ------------------------------------------------------
# 1. authorizedSink: the value flowing to the exact subprocess env the
#    grant exists to authorize (e.g. `pass-cli run --env-file ...`, which
#    masks its own stdout/stderr by default -- this destination models
#    the env var itself, not that masked terminal output).
# 2. holderTranscript: the concrete CIT-96 violation -- the holder agent's
#    own transcript naively echoes the raw value it just acquired. Flagged
#    even though holder+grant match, because a transcript is an export
#    sink, not an authorized sink.
# 3-6. otherAgentContext / supervisorReport / linearComment /
#    networkPayload: the same raw value having propagated further,
#    representing later hops out of the holder's transcript.
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
  '{acquisitions: $acquisitions, destinations: $destinations}' > "$OUT"
echo "wrote $OUT" >&2

# Positive control: the same acquisition, but only the authorized
# destination -- proves the fact doesn't just always flag, i.e. a
# same-grant/same-holder authorized-sink destination passes clean.
CLEAN_OUT="$OUT_DIR/taint-trace-clean-observed.json"
clean_destinations_json="$(echo "$destinations_json" | jq '[.[0]]')"
jq -n --argjson acquisitions "$acquisitions_json" --argjson destinations "$clean_destinations_json" \
  '{acquisitions: $acquisitions, destinations: $destinations}' > "$CLEAN_OUT"
echo "wrote $CLEAN_OUT" >&2
