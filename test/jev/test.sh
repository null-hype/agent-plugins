#!/bin/bash

# Runs against an auto-generated devcontainer.json that includes the 'jev'
# Feature with no options. All jev calls here use the mock backend or
# --print-request, so no network call to Jev and no API key are involved.
#
#    devcontainer features test -f jev -i mcr.microsoft.com/devcontainers/base:ubuntu .

set -e

source dev-container-features-test-lib

T="$(mktemp -d)"

# A fixture with harness-only meta/expected that must NEVER reach the model.
# STATE-MARKER lives in .state (should be sent); CVE-LEAK-9999 lives in
# meta/expected (must not be sent) -- expected.rationale is where the real CVE
# name would sit.
cat > "$T/fixture.json" <<'EOF'
{
  "meta": { "case": "CVE-LEAK-9999 harness only", "hint_level": 0 },
  "state": {
    "diff_items": [ { "component": "STATE-MARKER", "kind": "modified" } ],
    "files": { "config.rb": "STATE-MARKER config body" }
  },
  "expected": { "decided": true, "rationale": "CVE-LEAK-9999 real advisory text" }
}
EOF

cat > "$T/questions.json" <<'EOF'
{
  "a02_security_misconfiguration": {
    "type": "noul",
    "instructions": "Does the resulting system contain an insecure default?"
  }
}
EOF

# A malformed question (wrong type) and one missing instructions.
echo '{"q1":{"type":"boolean","instructions":"x"}}' > "$T/bad-type.json"
echo '{"q1":{"type":"noul"}}' > "$T/bad-missing.json"

# Canned mock answers (both accepted shapes) and an out-of-range one.
echo '{"a02_security_misconfiguration": 0.9}' > "$T/ans.json"
echo '{"a02_security_misconfiguration": 1.5}' > "$T/ans-bad.json"

check "jev is on PATH" bash -c "jev --help >/dev/null"
check "first-party jev skill installed" bash -c "test -f \$HOME/.claude/skills/jev/SKILL.md"
check "third-party TypeSafe skill installed" bash -c "ls -d \$HOME/.claude/skills/*typesafe* >/dev/null 2>&1"

# The most important check: only .state leaves the process.
check "request carries state" bash -c "jev --print-request -q '$T/questions.json' '$T/fixture.json' | grep -q STATE-MARKER"
check "request does NOT leak meta/expected" bash -c "! jev --print-request -q '$T/questions.json' '$T/fixture.json' | grep -q CVE-LEAK-9999"

# Output contract, via the mock backend.
check "mock returns the question's probability" bash -c "jev --backend mock --mock-answers '$T/ans.json' -q '$T/questions.json' '$T/fixture.json' | grep -q '\"a02_security_misconfiguration\": 0.9'"
check "output records the backend" bash -c "jev --backend mock --mock-answers '$T/ans.json' -q '$T/questions.json' '$T/fixture.json' | grep -q '\"backend\": \"mock\"'"

# The request contract (Jev.pkl via pkl-python + generated types): a valid request
# reaches a stubbed transport unchanged, an invalid one never does. No network.
check "contract: typed request loads; invalid fails Pkl before transport" bash -c "/usr/local/lib/jev/venv/bin/python '$(dirname "$0")/contract_test.py' \$(command -v jev)"

# Rejections happen before any backend call.
check "malformed question (wrong type) rejected" bash -c "! jev --backend mock --mock-answers '$T/ans.json' -q '$T/bad-type.json' '$T/fixture.json'"
check "malformed question (no instructions) rejected" bash -c "! jev --backend mock --mock-answers '$T/ans.json' -q '$T/bad-missing.json' '$T/fixture.json'"
check "out-of-range probability rejected" bash -c "! jev --backend mock --mock-answers '$T/ans-bad.json' -q '$T/questions.json' '$T/fixture.json'"

# Never invent probabilities.
check "mock without --mock-answers fails" bash -c "! jev --backend mock -q '$T/questions.json' '$T/fixture.json'"
check "real backend without API key fails loudly" bash -c "unset TYPESAFE_API_KEY; ! jev --backend real -q '$T/questions.json' '$T/fixture.json'"

reportResults
