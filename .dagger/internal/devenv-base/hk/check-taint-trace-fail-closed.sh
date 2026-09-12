#!/usr/bin/env bash
# Proves Scope.pkl's required-field / non-empty-trace validation actually
# fails closed. pkl:test's facts{} block can't itself catch a thrown Pkl
# error without aborting the whole test module's evaluation (Pkl 0.28.2/
# 0.32.1 have no catch()), so this script drives the two malformed-input
# cases as separate `pkl eval` subprocesses and records their real
# pass/fail outcome to observed-JSON for Scope.test.pkl's 4th fact to
# assert on -- not a hardcoded literal.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKL_DIR="$DIR/../pkl"
OUT_DIR="$DIR/../build"
mkdir -p "$OUT_DIR"

# Missing-field case: an acquisition with no `releasedAt`.
cat > "$OUT_DIR/taint-trace-missing-field.json" <<'JSON'
{
  "acquisitions": [
    {"grantId": "grant-x", "holderAgent": "agent-x", "value": "v", "source": "s"}
  ],
  "destinations": [
    {"kind": "authorizedSink", "holderAgent": "agent-x", "grantId": "grant-x", "content": "v", "observedAt": "2026-01-01T00:00:00Z"}
  ]
}
JSON

# Empty-trace case: no acquisitions and no destinations at all.
cat > "$OUT_DIR/taint-trace-empty.json" <<'JSON'
{"acquisitions": [], "destinations": []}
JSON

# Evaluates Scope.traceFrom against $1 in a throwaway module; returns 0
# (success, meaning "rejected as required") if that eval fails, 1
# otherwise. Inverted relative to a normal check because the desired
# outcome here is that the malformed input causes a Pkl error.
assert_rejected() {
  local fixture="$1" module
  module="$(mktemp --suffix=.pkl)"
  cat > "$module" <<PKL
import "pkl:json"
import "$PKL_DIR/Scope.pkl" as scope
result = scope.traceFrom(new json.Parser {}.parse(read("$fixture").text))
output { text = "acqs=\(result.acquisitions.length)" }
PKL
  local rejected=0
  mise exec -- pkl eval "$module" >/dev/null 2>&1 || rejected=1
  rm -f "$module"
  [ "$rejected" -eq 1 ]
}

missing_field_rejected=false
assert_rejected "$OUT_DIR/taint-trace-missing-field.json" && missing_field_rejected=true

empty_trace_rejected=false
assert_rejected "$OUT_DIR/taint-trace-empty.json" && empty_trace_rejected=true

jq -n \
  --argjson missingFieldRejected "$missing_field_rejected" \
  --argjson emptyTraceRejected "$empty_trace_rejected" \
  '{missingFieldRejected: $missingFieldRejected, emptyTraceRejected: $emptyTraceRejected}' \
  > "$OUT_DIR/taint-trace-failclosed-observed.json"
echo "wrote $OUT_DIR/taint-trace-failclosed-observed.json" >&2
