#!/bin/bash

# CIT-286 live-smoke scenario (global): a REAL reasoning agent + a REAL Jev call
# on the toy case (CIT-285). This is the one scenario that is NOT deterministic;
# it is the counterpart to cit-286-contract.sh (canned evidence + mock jev).
#
# Built from the 'cit-286-toy-smoke' entry in test/_global/scenarios.json, which
# layers the 'evidence', 'jev' and 'pass-cli' features onto an agent-capable
# devenv image (see this scenario's Dockerfile). Run with:
#
#    devcontainer features test --global-scenarios-only .
#
# Self-contained (skill Rule S): the toy tool + README are baked into the image
# at /opt/toy-case/root by this scenario's Dockerfile; the expected-evidence
# answer key lives at /opt/toy-case/harness, OUTSIDE the inspected root, so it
# never reaches the agent or the model (skill Rule D4). Nothing is read from the
# checkout at runtime.
#
# Honesty contract (skill Rules M2/M3/V1): the live method needs three things
# this scenario cannot conjure -- a real reasoning-agent runner, a working
# TYPESAFE_API_KEY, and the toy root to inspect. When a prerequisite is missing
# the scenario prints the SPECIFIC blocker and SKIPS (exit 0); it never fabricates
# an agent output or a Jev answer, and it reports exactly which halves ran live.
#
# Rules applied: S (self-contained), D4 (answer key out of the inspected root),
# M2/M3 (live vs. deterministic, skip-with-blocker), V1 (report what actually ran).

set -e

source dev-container-features-test-lib

ROOT="/opt/toy-case/root"                       # inspected image root (agent-visible)
HARNESS="/opt/toy-case/harness"                 # answer key + case.json (agent-invisible)
KEY_FILE="$HARNESS/expected-evidence.json"
T="$(mktemp -d)"

# ---------------------------------------------------------------------------
# Always-live build-context checks: the container is wired correctly.
check "evidence-validate is on PATH" bash -c "command -v evidence-validate"
check "jev is on PATH"               bash -c "jev --help >/dev/null"
check "toy inspected root baked in"  test -f "$ROOT/opt/toy/README.md"
check "answer key is OUTSIDE the inspected root (Rule D4)" \
    bash -c "test -f '$KEY_FILE' && test ! -e '$ROOT/expected-evidence.json'"

# The answer key's excerpt is verbatim-present at its source_path under the
# inspected root. This proves the toy root is well-formed and groundable -- the
# same grounding the agent's output will face -- without giving the key to any
# model.
check "toy root grounds the expected-evidence key" \
    evidence-validate --root "$ROOT" "$KEY_FILE"

# Generic Noul questions for the live smoke (no CVE/case data -- Rule D2).
cat > "$T/questions.json" <<'EOF'
{ "unenforced_never": { "type": "noul",
    "instructions": "A component states a rule that must never be violated. Does the composed system fail to enforce it (an unenforced never)?" } }
EOF

# ---------------------------------------------------------------------------
# Live half 1 -- a REAL reasoning-agent run over the toy root.
#
# The reasoning-agent runner is the CIT-271 harness (isolated filesystem-only
# tools, trace recording). It is not present on this branch, so this half is
# recorded as BLOCKED rather than faked. When the runner lands (CIT-271/CIT-288),
# set REASONING_AGENT_RUNNER to its bin; this scenario then runs it scoped to
# $ROOT at the toy's smoke hint level (1) and captures evidence to $T/evidence.json.
AGENT_EVIDENCE=""
if [ -n "${REASONING_AGENT_RUNNER:-}" ] && command -v "${REASONING_AGENT_RUNNER}" >/dev/null 2>&1; then
    echo "Running real reasoning agent (${REASONING_AGENT_RUNNER}) over $ROOT ..."
    HINT_LEVEL="$(python3 -c "import json;print(json.load(open('$HARNESS/case.json'))['smoke_hint_level'])")"
    "${REASONING_AGENT_RUNNER}" --root "$ROOT" --hint-level "$HINT_LEVEL" --out "$T/evidence.json"
    AGENT_EVIDENCE="$T/evidence.json"
    check "agent output validates against the evidence format" evidence-validate "$AGENT_EVIDENCE"
    check "agent every-excerpt grounded in the toy root" evidence-validate --root "$ROOT" "$AGENT_EVIDENCE"
else
    echo "::warning::cit-286-toy-smoke: SKIPPING the real-agent half -- no reasoning-agent runner."
    echo "  Blocker: set REASONING_AGENT_RUNNER to the CIT-271 harness bin (not on this branch;"
    echo "  lands with CIT-271/CIT-288). This scenario is the wiring point for that runner."
fi

# ---------------------------------------------------------------------------
# Live half 2 -- a REAL Jev call.
#
# Uses the agent's own evidence when the agent half ran; otherwise the toy fixture
# state directly, so "is Jev really reachable and does it honor the [0,1] contract"
# can still be exercised live. Needs TYPESAFE_API_KEY -- resolved via pass-cli when
# a Proton Pass token is present, never placed in argv.
cat > "$T/fixture.json" <<'EOF'
{ "state": { "diff_items": [ { "component": "noteexpand", "kind": "unchanged" } ],
             "files": { "opt/toy/service.sh": "runs the expander on caller input unchanged" } } }
EOF
JEV_INPUT="$T/fixture.json"
[ -n "$AGENT_EVIDENCE" ] && echo "(Jev will judge alongside the agent's real evidence output.)"

run_real_jev() { jev --backend real -q "$T/questions.json" "$JEV_INPUT"; }

if [ -n "${TYPESAFE_API_KEY:-}" ]; then
    check "REAL Jev returns a probability in [0,1] per question" bash -c "
        run_real_jev() { jev --backend real -q '$T/questions.json' '$JEV_INPUT'; }
        out=\$(run_real_jev) || exit 1
        echo \"\$out\" | python3 -c 'import json,sys; d=json.load(sys.stdin); ps=d[\"probabilities\"].values(); sys.exit(0 if d[\"backend\"]==\"real\" and all(0.0<=float(p)<=1.0 for p in ps) else 1)'"
elif [ -n "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:-}" ] && [ -n "${PASS_CLI_ENV_FILE:-}" ]; then
    echo "Resolving TYPESAFE_API_KEY via pass-cli for a real Jev call ..."
    if ! command -v pass-cli >/dev/null 2>&1; then
        curl -fsSL https://proton.me/download/pass-cli/install.sh | bash
    fi
    export PROTON_PASS_SESSION_DIR="/tmp/pass-agent-toy-smoke"
    export PROTON_PASS_AGENT_REASON="cit-286-toy-smoke: real Jev call on the toy case"
    pass-cli login && pass-cli info
    check "REAL Jev (key via pass-cli) returns a probability in [0,1]" bash -c "
        pass-cli run --env-file '$PASS_CLI_ENV_FILE' -- \
          jev --backend real -q '$T/questions.json' '$JEV_INPUT' \
          | python3 -c 'import json,sys; d=json.load(sys.stdin); ps=d[\"probabilities\"].values(); sys.exit(0 if d[\"backend\"]==\"real\" and all(0.0<=float(p)<=1.0 for p in ps) else 1)'"
    pass-cli logout || true
else
    echo "::warning::cit-286-toy-smoke: SKIPPING the real-Jev half -- no credential."
    echo "  Blocker: set TYPESAFE_API_KEY, or provide PROTON_PASS_PERSONAL_ACCESS_TOKEN +"
    echo "  PASS_CLI_ENV_FILE (a pass:// reference to the key) so pass-cli can resolve it."
fi

reportResults
